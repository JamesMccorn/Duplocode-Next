/**
 * @duplocode/worker-gateway
 *
 * An authenticated, scrubbing boundary that ingests UNTRUSTED worker
 * observations into an injected append-only sink. Authentication and scrubbing
 * are fully injected so the gateway never carries trust or scrub logic of its
 * own; the process that wires it in owns both.
 *
 * Ingest path (fail closed at every step):
 *    1. Validate the untrusted envelope shape; malformed events are rejected.
 *    2. Authenticate the event against injected credentials; unauthenticated
 *      events are rejected, and the authenticated worker is bound to the run it
 *      names.
 *    3. Scrub the payload BEFORE anything is handed to the durable sink.
 *    4. Stamp every accepted record as a `producerTrustClass: 'untrusted-worker'`
 *     observation with `publicationAuthority: false`.
 *
 * The gateway NEVER turns an observation into a PASS or into publication
 * authority. Its result space is exactly `{ accepted, rejected }` and every
 * accepted record is classified as an observation: even a worker that claims a
 * PASS or a `publicationAuthorized` decision in its payload is recorded as an
 * untrusted scratch observation, exactly like any other claim.
 */

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                 */
/* -------------------------------------------------------------------------- */

/** The closed set of worker-observation classes the gateway will accept. */
export type ObservationClass =
    'MODEL_CALLED' | 'TOOL_RESULT' | 'FILE_MUTATED' | 'ARTIFACT_UPLOADED'

export interface ArtifactReference {
  readonly digest: `sha256:${string}`
  readonly mediaType: string
  readonly uri: string
}

/**
 * The untrusted payload a worker streams in. Everything here is attacker-
 * controlled except the credentials carried alongside it.
 */
export interface RawWorkerObservation {
  readonly id: string
  readonly runId: string
  readonly producer: string
  readonly sequence: number
  readonly observedAt: string
  readonly class: ObservationClass
  readonly payload: unknown
  readonly artifactReferences?: readonly ArtifactReference[]
}

/* -------------------------------------------------------------------------- */
/* Injected authentication boundary                                            */
/* -------------------------------------------------------------------------- */

/** Opaque credentials presented with an observation. */
export interface WorkerCredentials {
  readonly principal: string
  readonly token: string
}

/** The authenticated worker, including the run it is bound to. */
export interface WorkerIdentity {
  readonly workerId: string
  readonly runId: string
}

/**
 * Decides whether a credentials pair authenticates a worker for the stated run.
 * A fully injected port: the gateway makes no trust judgment itself.
 */
export interface WorkerAuthenticator {
  authenticate(raw: RawWorkerObservation, credentials: WorkerCredentials): WorkerIdentity | null
}

/**
 * Fails closed: authenticates nothing. A gateway wired without an explicit
 * authenticator therefore ingests zero events.
 */
export function inertWorkerAuthenticator(): WorkerAuthenticator {
  return { authenticate: () => null }
}

/* -------------------------------------------------------------------------- */
/* Injected scrubbing boundary                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The scrubbed, sink-safe view of a worker payload. `retained` must never carry
 * raw secrets; the field is the only content that may reach the durable store.
 */
export interface ScrubbedPayload {
  readonly classification: 'untrusted-worker'
  readonly redacted: boolean
  readonly retained: unknown
}

/** Removes secret/attacker content from a raw observation payload. */
export interface ObservationScrubber {
  scrub(raw: RawWorkerObservation): ScrubbedPayload
}

/**
 * Fails closed by redaction: retains nothing from the worker's payload, so a
 * scrubbed observation can carry no secret even when the scrubber is misused.
 */
export function failClosedScrubber(): ObservationScrubber {
  return {
    scrub: () => ({ classification: 'untrusted-worker', redacted: true, retained: null })
  }
}

/* -------------------------------------------------------------------------- */
/* Injected append-only sink and accepted record                               */
/* -------------------------------------------------------------------------- */

/**
 * The durable record the gateway hands to the sink. It is stamped so that every
 * accepted worker claim is unambiguously an observation and never a decision:
 * the authority fields are fixed by construction and are NOT copied from the
 * raw (attacker-controlled) envelope.
 */
export interface AcceptedObservation {
  readonly id: string
  readonly runId: string
  readonly producer: string
  readonly producerTrustClass: 'untrusted-worker'
  readonly class: ObservationClass
  readonly sequence: number
  readonly observedAt: string
  readonly receivedAt: string
  readonly scrubbed: ScrubbedPayload
  readonly authenticatedBy: string
  readonly artifactReferences: readonly ArtifactReference[]
  /** Authority boundary: this record is data, not a decision. */
  readonly authority: 'observation'
  readonly publicationAuthority: false
  readonly claimTruth: 'untrusted'
}

/**
 * The append-only boundary the gateway writes through. Append-only and
 * idempotent on `id` are the only invariants the sink promises; the gateway
 * relies on neither clock nor randomness.
 */
export interface ObservationSink {
  append(observation: AcceptedObservation): void
  list(): readonly AcceptedObservation[]
}

/**
 * An in-memory append-only sink, used in tests and as a default for local wiring.
 * Append-only: an `id` is recorded at most once and never overwritten.
 */
export function createInMemoryObservationSink(): ObservationSink {
  const records: AcceptedObservation[] = []
  const seen = new Set<string>()
  return {
    append(observation) {
      if (seen.has(observation.id)) return
      seen.add(observation.id)
      records.push(observation)
    },
    list() {
      return records
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Result space — deliberately contains no PASS / no publication authority      */
/* -------------------------------------------------------------------------- */

/**
 * The only two outcomes of ingest. There is no `pass`, no `publish`, and no
 * `authorize` variant: the gateway cannot surface publication authority.
 */
export type IngestOutcome =
    | { readonly status: 'accepted'; readonly observation: AcceptedObservation }
    | { readonly status: 'rejected'; readonly reason: string }

/* -------------------------------------------------------------------------- */
/* Gateway                                                                     */
/* -------------------------------------------------------------------------- */

export interface ObservationsGateway {
  /** Ingest one untrusted worker observation under the given credentials. */
  ingest(raw: unknown, credentials: WorkerCredentials): IngestOutcome
}

export interface ObservationsGatewayDeps {
  readonly authenticator: WorkerAuthenticator
  readonly scrubber: ObservationScrubber
  readonly sink: ObservationSink
  /** Injectable clock for `receivedAt`; defaults to a deterministic constant. */
  readonly now?: () => string
}

const OBSERVATION_CLASSES: readonly ObservationClass[] =
    ['MODEL_CALLED', 'TOOL_RESULT', 'FILE_MUTATED', 'ARTIFACT_UPLOADED']

function isObservationClass(value: unknown): value is ObservationClass {
  return typeof value === 'string' && (OBSERVATION_CLASSES as readonly string[]).includes(value)
}

/**
 * Type-guard + shape check for the untrusted envelope. Anything that is not a
 * well-formed observation is rejected as `malformed-observation` before
 * authentication is ever attempted.
 */
function validate(raw: unknown): RawWorkerObservation | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0) return null
  if (typeof r.runId !== 'string' || r.runId.length === 0) return null
  if (typeof r.producer !== 'string' || r.producer.length === 0) return null
  if (typeof r.sequence !== 'number' || !Number.isInteger(r.sequence) || r.sequence < 0) return null
  if (typeof r.observedAt !== 'string' || r.observedAt.length === 0) return null
  if (!isObservationClass(r.class)) return null
  // `payload` must be present (its value may be undefined/null); a missing field
  // is malformed because the observation asserts the worker produced something.
  if (!('payload' in r)) return null

  let artifactReferences: readonly ArtifactReference[] | undefined
  if (r.artifactReferences !== undefined) {
    if (!Array.isArray(r.artifactReferences)) return null
    const refs: ArtifactReference[] = []
    for (const a of r.artifactReferences) {
      if (typeof a !== 'object' || a === null) return null
      const ar = a as Record<string, unknown>
      if (typeof ar.digest !== 'string' || typeof ar.mediaType !== 'string' || typeof ar.uri !== 'string') return null
      refs.push({ digest: `sha256:${ar.digest}`, mediaType: ar.mediaType, uri: ar.uri })
    }
    artifactReferences = refs
  }

  return {
    id: r.id,
    runId: r.runId,
    producer: r.producer,
    sequence: r.sequence,
    observedAt: r.observedAt,
    class: r.class,
    payload: r.payload,
    ...(artifactReferences !== undefined ? { artifactReferences } : {})
  }
}

/**
 * Build the gateway. Authentication runs only after a well-formed envelope is
 * established; scrubbing runs only on an authenticated event and strictly
 * before the sink is written. The accepted record's authority fields are fixed
 * here and are never copied from the attacker-controlled envelope.
 */
export function createObservationsGateway(deps: ObservationsGatewayDeps): ObservationsGateway {
  const authenticator = deps.authenticator
  const scrubber = deps.scrubber
  const sink = deps.sink
  const now = deps.now ?? (() => '0')

  return {
    ingest(raw, credentials) {
        // 1. Shape first — malformed events never authenticate, never scrub, never sink.
      const valid = validate(raw)
      if (valid === null) return { status: 'rejected', reason: 'malformed-observation' }

        // 2. Authentication — unauthenticated events are rejected and produce nothing.
      const identity = authenticator.authenticate(valid, credentials)
      if (identity === null) return { status: 'rejected', reason: 'unauthenticated' }
        // A worker authenticated for one run may not inject observations for another.
      if (identity.runId !== valid.runId) return { status: 'rejected', reason: 'run-mismatch' }

        // 3. Scrub before the durable sink ever sees the payload.
      const scrubbed = scrubber.scrub(valid)

        // 4. Stamp as an untrusted observation. Authority fields are fixed by
        //    construction; nothing that claims PASS/publication is carried through.
      const observation: AcceptedObservation = {
          id: valid.id,
          runId: valid.runId,
          producer: valid.producer,
          producerTrustClass: 'untrusted-worker',
          class: valid.class,
          sequence: valid.sequence,
          observedAt: valid.observedAt,
          receivedAt: now(),
          scrubbed,
          authenticatedBy: identity.workerId,
          artifactReferences: valid.artifactReferences ?? [],
          authority: 'observation',
          publicationAuthority: false,
          claimTruth: 'untrusted'
        }

        sink.append(observation)
        return { status: 'accepted', observation }
    }
  }
}
