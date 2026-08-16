/**
 * In-memory bounded leases for worker, model-route, and event-ingest authority.
 *
 * Design principles:
 *   - Bounded: a lease is only ever created with explicit, non-empty `limits`,
 *     and the store enforces an explicit, required capacity (`maxLeases`).
 *   - Attributed: every lease names a non-empty `issuer` and `subject`.
 *   - Time-explicit: every lease carries an `expiresAt` boundary string, and
 *     validity is judged ONLY against a caller-supplied `asOf` boundary string.
 *   - No wall-clock auto-failure: the store never reads the current time and
 *     never decides a lease has "expired" on its own. Expiry is a comparison
 *     between two caller-supplied boundary strings.
 *   - Fail closed: a leaked lookup of an unknown, revoked, expired, or
 *     time-ambiguous lease surfaces as `unavailable`, never as `valid`.
 */

/** Leases govern three bounded authority kinds. */
export type LeaseKind = 'worker' | 'model-route' | 'event-ingest'

/**
 * Explicit per-lease limits. A lease without any limits is rejected at
 * issuance, so an unbounded lease can never be minted.
 */
export type LeaseLimits = Record<string, number | string>

const LEASE_KINDS: readonly LeaseKind[] = ['worker', 'model-route', 'event-ingest']

function isLeaseKind(value: unknown): value is LeaseKind {
  return typeof value === 'string' && (LEASE_KINDS as readonly string[]).includes(value)
}

/**
 * A non-empty, well-formed boundary string. Only ISO-8601 / epoch forms that
 * parse to a finite instant are accepted; anything else is rejected so a
 * malformed boundary can never silently read as "no expiry".
 */
export function parseBoundary(value: string): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
     throw new Error('expiry boundary must be a non-empty string')
  }
  const millis = Date.parse(value)
  if (!Number.isFinite(millis) || Number.isNaN(millis)) {
     throw new Error(`unrecognized time boundary: ${value}`)
  }
  return millis
}

/** Request to mint a lease. Every field below is required and validated. */
export interface LeaseRequest {
  /** Optional stable id. Omit to let the store assign one. */
  readonly id?: string
  /** Which authority this lease bounds. Required. */
  readonly kind: LeaseKind
  /** Principal that grants the authority. Required, non-empty. */
  readonly issuer: string
  /** Principal that holds the authority. Required, non-empty. */
  readonly subject: string
  /** Explicit bounds on the authority. Required, non-empty. */
  readonly limits: LeaseLimits
  /** Expiry boundary string. Required, non-empty. */
  readonly expiresAt: string
}

/** An issued lease, as recorded in the store. Read-only after issuance. */
export interface LeaseRecord {
  readonly id: string
  readonly kind: LeaseKind
  readonly issuer: string
  readonly subject: string
  readonly limits: Readonly<LeaseLimits>
  /** The original expiry boundary string, preserved verbatim. */
  readonly expiresAt: string
  /** The instant, in epoch milliseconds, that the boundary string resolves to. */
  readonly expiresAtMillis: number
  readonly revoked: boolean
}

/** Why a lease is not currently usable. */
export type UnavailableReason =
   | 'not-found'
   | 'revoked'
   | 'expired'
   | 'invalid-boundary'

/**
 * The result of a lookup or recheck. A lease is either `valid` at the supplied
 * `asOf`, or `unavailable` for an explicit reason. There is no third outcome:
 * ambiguity resolves to `unavailable`.
 */
export type LeaseStatus =
   | { readonly status: 'valid'; readonly lease: LeaseRecord }
   | { readonly status: 'unavailable'; readonly reason: UnavailableReason; readonly id: string }

export function isAvailable(status: LeaseStatus): status is Extract<LeaseStatus, { status: 'valid' }> {
  return status.status === 'valid'
}

/** Store configuration. `maxLeases` is required: the store is always bounded. */
export interface LeaseStoreConfig {
  /** Maximum number of live + revoked lease records. Required, ≥ 1. */
  readonly maxLeases: number
}

/**
 * Fail-closed decision of whether a recorded lease is usable at `asOf`.
 *
 * A lease is `valid` only when it exists, is not revoked, and its expiry
 * boundary is strictly after `asOf`. At exactly the boundary, or after it, the
 * lease is `expired`. A revoked lease is `revoked` regardless of time. Any
 * unparseable boundary — on either side — is `invalid-boundary`. The decision
 * is a pure comparison between two supplied boundary strings.
 */
export function evaluateLease(
  record: LeaseRecord,
  asOf: string
): LeaseStatus {
  if (record.revoked) {
     return { status: 'unavailable', reason: 'revoked', id: record.id }
  }
  let asOfMillis: number
  try {
     asOfMillis = parseBoundary(asOf)
  } catch {
     return { status: 'unavailable', reason: 'invalid-boundary', id: record.id }
  }
  if (asOfMillis >= record.expiresAtMillis) {
     return { status: 'unavailable', reason: 'expired', id: record.id }
  }
  return { status: 'valid', lease: record }
}

export class LeaseStore {
  #leases = new Map<string, LeaseRecord>()
  #counter = 0
  readonly maxLeases: number

  constructor(config: LeaseStoreConfig) {
    if (!Number.isInteger(config.maxLeases) || config.maxLeases < 1) {
      throw new Error('maxLeases must be a positive integer')
    }
    this.maxLeases = config.maxLeases
  }

  /** Number of currently recorded lease records (live or revoked). */
  get size(): number {
    return this.#leases.size
  }

  /**
   * Mint a lease. Fails closed on any missing/empty required field, on a
   * malformed expiry boundary, on a duplicate id, or when the store is at its
   * explicit capacity. The capacity check protects the bounded invariant.
   */
  acquire(request: LeaseRequest): LeaseRecord {
     if (!isLeaseKind(request.kind)) {
      throw new Error('unknown lease kind')
    }
    if (typeof request.issuer !== 'string' || request.issuer.trim().length === 0) {
      throw new Error('issuer is required')
    }
    if (typeof request.subject !== 'string' || request.subject.trim().length === 0) {
      throw new Error('subject is required')
    }
    if (
      request.limits === null ||
      typeof request.limits !== 'object' ||
      Object.keys(request.limits).length === 0
    ) {
      throw new Error('limits are required and must be explicit')
    }
    const expiresAtMillis = parseBoundary(request.expiresAt)

    const id =
      request.id !== undefined
        ? request.id
        : `lease-${++this.#counter}`
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('lease id is required')
    }
    if (this.#leases.has(id)) {
      throw new Error(`lease id already exists: ${id}`)
    }
    if (this.#leases.size >= this.maxLeases) {
      throw new Error(`lease store at capacity (${this.maxLeases})`)
    }

    const record: LeaseRecord = {
      id,
      kind: request.kind,
      issuer: request.issuer,
      subject: request.subject,
      // Freeze limits so they cannot be widened after issuance.
      limits: Object.freeze({ ...request.limits }) as Readonly<LeaseLimits>,
      expiresAt: request.expiresAt,
      expiresAtMillis,
      revoked: false,
    }
    // Shallow copy so external mutation of the record cannot reach in.
    this.#leases.set(id, { ...record })
    return record
  }

  /**
   * Revoke a lease by id. Returns `true` if a live lease was revoked,
   * `false` if the id is unknown or already revoked. Revocation is permanent:
   * the record stays, so lookups surface it as `unavailable/revoked`.
   */
  revoke(id: string): boolean {
    const record = this.#leases.get(id)
    if (record === undefined) return false
    if (record.revoked) return false
    this.#leases.set(id, { ...record, revoked: true })
    return true
  }

  /**
   * Look up a lease at a caller-supplied time boundary `asOf`. Returns a
   * `valid` status only for a live, not-yet-expired lease. Unknown, revoked,
   * expired, or time-ambiguous results all surface as `unavailable`.
   */
  lookup(id: string, asOf: string): LeaseStatus {
    const record = this.#leases.get(id)
    if (record === undefined) {
      return { status: 'unavailable', reason: 'not-found', id }
    }
    return evaluateLease(record, asOf)
  }

  /**
   * Return the recorded (possibly revoked/expired) lease record, or
   * `undefined` if the id is unknown. Pure retrieval: it never decides
   * validity, so callers must route through `lookup` for that.
   */
  get(id: string): LeaseRecord | undefined {
    const record = this.#leases.get(id)
    return record === undefined ? undefined : { ...record }
  }

  /** Whether a lease record for `id` exists (live or revoked). */
  has(id: string): boolean {
    return this.#leases.has(id)
  }

  /** All recorded lease ids, in insertion order. */
  ids(): string[] {
    return [...this.#leases.keys()]
  }
}
