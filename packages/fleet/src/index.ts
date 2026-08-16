/**
 * Compact, fake-backed FleetSnapshot service.
 *
 * The service turns raw observations from an injected {@link FleetSource} into a
 * typed snapshot that carries an explicit freshness state: `fresh`, `stale`, or
 * `unavailable`. Each observation describes the fleet's endpoints with an endpoint
 * model, a residency label, and a per-slot free/occupied view. Capacity is only
 * granted against a `fresh` snapshot; stale and unavailable snapshots refuse capacity.
 */

/** Freshness of the last successful observation, or availability of the source. */
export type SnapshotState = 'fresh' | 'stale' | 'unavailable'

/** A schedulable unit on an endpoint. */
export interface FleetSlot {
  readonly id: string
  readonly free: boolean
}

/** A fleet endpoint with a model, a residency, and its slots. */
export interface FleetEndpoint {
  readonly id: string
  /** Hardware or logical model the endpoint provides. */
  readonly model: string
  /** Residency / availability label, e.g. a geo or security domain. */
  readonly residency: string
  readonly slots: readonly FleetSlot[]
}

/** A typed, freshness-tagged view of the fleet. */
export interface FleetSnapshot {
  readonly state: SnapshotState
  /** Epoch milliseconds when this observation was taken. */
  readonly observedAt: number
  readonly endpoints: readonly FleetEndpoint[]
}

/** Result of asking the source for a fresh observation. */
export type FleetObservation =
  | { readonly kind: 'ok'; readonly observedAt: number; readonly endpoints: readonly FleetEndpoint[] }
  | { readonly kind: 'unavailable'; readonly reason: string }

/** The injected backend. The service never reaches a network; the backend is a fake. */
export interface FleetSource {
  observe(): Promise<FleetObservation>
}

export interface FleetSnapshotServiceOptions {
  readonly source: FleetSource
  /** Injectable clock (epoch ms). Defaults to Date.now. */
  readonly now?: () => number
  /** Age in ms after which a snapshot is `stale`. Defaults to 30000. */
  readonly staleAfterMs?: number
}

/** Granted capacity: the slot a run was placed on a matching free endpoint. */
export interface CapacityGrant {
  readonly runId: string
  readonly endpointId: string
  readonly slotId: string
  readonly model: string
  readonly residency: string
}

/** Request for capacity, optionally constrained by model and residency. */
export interface CapacityRequest {
  readonly runId: string
  readonly model?: string
  readonly residency?: string
}

/** Thrown when the snapshot is not fresh enough to trust for scheduling. */
export class RefusedCapacityError extends Error {
  constructor(
    readonly state: SnapshotState,
    readonly runId: string,
  ) {
    super(`Refusing capacity: fleet snapshot is ${state}; only fresh snapshots grant capacity (run ${runId}).`)
    this.name = 'RefusedCapacityError'
  }
}

/** Thrown when a fresh snapshot has no matching free slot. */
export class InsufficientCapacityError extends Error {
  constructor(readonly runId: string, readonly request: CapacityRequest) {
    super(`No free slot matches capacity request for run ${runId}.`)
    this.name = 'InsufficientCapacityError'
  }
}

/**
 * Standalone capacity gate. Refuses any non-`fresh` snapshot outright, then places
 * the run on the first matching free slot. Pure: no clock, no source, no mutation
 * of the caller's slot objects.
 */
export function grantCapacity(snapshot: FleetSnapshot, request: CapacityRequest): CapacityGrant {
  if (snapshot.state !== 'fresh') {
    throw new RefusedCapacityError(snapshot.state, request.runId)
  }
  for (const endpoint of snapshot.endpoints) {
    if (request.model !== undefined && endpoint.model !== request.model) continue
    if (request.residency !== undefined && endpoint.residency !== request.residency) continue
    const slot = endpoint.slots.find((s) => s.free)
    if (slot !== undefined) {
      return {
        runId: request.runId,
        endpointId: endpoint.id,
        slotId: slot.id,
        model: endpoint.model,
        residency: endpoint.residency,
      }
    }
  }
  throw new InsufficientCapacityError(request.runId, request)
}

/**
 * Cached freshness-tagged snapshot of the fleet. `refresh()` re-observes the source
 * and recomputes state; `current()` returns the most recent snapshot without touching
 * the source. `grantCapacity` operates on `current()` and refuses stale/unavailable.
 */
export class FleetSnapshotService {
  readonly #source: FleetSource
  readonly #now: () => number
  readonly #staleAfterMs: number
  #cache: FleetSnapshot | undefined

  constructor(options: FleetSnapshotServiceOptions) {
    this.#source = options.source
    this.#now = options.now ?? (() => Date.now())
    this.#staleAfterMs = options.staleAfterMs ?? 30_000
  }

  /** Recompute the snapshot from the source and return it. */
  async refresh(): Promise<FleetSnapshot> {
    let observation: FleetObservation
    try {
      observation = await this.#source.observe()
    } catch (cause) {
      observation = { kind: 'unavailable', reason: cause instanceof Error ? cause.message : String(cause) }
    }

    if (observation.kind === 'unavailable') {
      this.#cache = { state: 'unavailable', observedAt: this.#now(), endpoints: [] }
    } else {
      const age = this.#now() - observation.observedAt
      this.#cache = {
        state: age > this.#staleAfterMs ? 'stale' : 'fresh',
        observedAt: observation.observedAt,
        endpoints: observation.endpoints,
      }
    }
    return this.#cache
  }

  /** The most recent snapshot, or undefined before the first refresh. */
  current(): FleetSnapshot | undefined {
    return this.#cache
  }

  /** Grant capacity against the current cached snapshot; refuses if not fresh. */
  grantCapacity(request: CapacityRequest): CapacityGrant {
    const snapshot = this.#cache
    if (snapshot === undefined) {
      throw new RefusedCapacityError('unavailable', request.runId)
    }
    return grantCapacity(snapshot, request)
  }
}

/**
 * Fake backend for tests and offline runs. Holds a mutable observation; callers can
 * flip it between `ok` (fresh/stale depending on the caller's clock) and unavailable.
 */
export class FakeFleetSource implements FleetSource {
  #pending: FleetObservation

  constructor(initial: FleetObservation = { kind: 'unavailable', reason: 'not started' }) {
    this.#pending = initial
  }

  /** Overwrite what the next observe() returns. */
  set(observation: FleetObservation): void {
    this.#pending = observation
  }

  observe(): Promise<FleetObservation> {
    return Promise.resolve(this.#pending)
  }
}
