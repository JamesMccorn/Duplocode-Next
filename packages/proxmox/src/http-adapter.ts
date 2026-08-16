/**
 * Injectable Proxmox HTTP boundary.
 *
 * The adapter never receives a raw admin token as an input. A run-scoped token is
 * resolved at send time through an injected {@link ScopedTokenSupplier}, and the
 * caller supplies the transport. Run/profile inputs therefore carry no secrets and
 * the transport is the only component that ever sees a token string.
 */

import type { WorkerProfile, WorkerReceipt, LifecycleState } from './index.js'

export type JsonValue = string | number | boolean | null
export interface ProxmoxBody { readonly [field: string]: JsonValue }

/** A minimal, transport-agnostic HTTP request the injected transport understands. */
export interface ProxmoxRequest {
  readonly method: 'GET' | 'POST' | 'DELETE'
  /** API path relative to the adapter root, e.g. /nodes/pve2/openvz/100/clone */
  readonly path: string
  readonly body?: ProxmoxBody
}

export interface ProxmoxResponse<T = Record<string, JsonValue>> {
  readonly ok: boolean
  readonly status: number
  readonly data: T
}

/**
 * Caller-provided transport. It is the single component that ever receives a token,
 * and it receives the resolved scoped token separately from the request inputs.
 */
export interface ProxmoxTransport {
  send<T>(request: ProxmoxRequest, scopedToken: string): Promise<ProxmoxResponse<T>>
}

/** Run/profile scope handed to the token supplier to mint a short-lived token. */
export interface TokenScope {
  readonly runId: string
  readonly profile: WorkerProfile
}

export type ScopedTokenSupplier = (scope: TokenScope) => Promise<string>

export interface ProxmoxAdapterOptions {
  readonly transport: ProxmoxTransport
  readonly tokenSupplier: ScopedTokenSupplier
  readonly apiRoot?: string
}

const TERMINAL_STATES: ReadonlySet<LifecycleState> = new Set<LifecycleState>(['lost', 'returned', 'destroyed'])

function pathFor(node: string, target: string, action: string): string {
  return `/nodes/${encodeURIComponent(node)}/openvz/${encodeURIComponent(String(target))}/${action}`
}

/**
 * Construct and dispatch Proxmox requests. Destructive actions (clone/start/destroy)
 * are exposed as pure request construction plus an execute step so the terminal-receipt
 * gate for destroy is enforced before any HTTP is issued.
 */
export class ProxmoxHttpAdapter {
  readonly #transport: ProxmoxTransport
  readonly #tokenSupplier: ScopedTokenSupplier
  readonly #root: string

  constructor(options: ProxmoxAdapterOptions) {
    this.#transport = options.transport
    this.#tokenSupplier = options.tokenSupplier
    this.#root = options.apiRoot ?? '/api2/json'
  }

  private scopeFor(profile: WorkerProfile, runId: string): TokenScope {
    return { runId, profile }
  }

  private async resolve(profile: WorkerProfile, runId: string): Promise<string> {
    return this.#tokenSupplier(this.scopeFor(profile, runId))
  }

  /** Read-only: resolve server/version information. No body, no mutation. */
  versionRequest(profile: WorkerProfile): ProxmoxRequest {
    return { method: 'GET', path: `/nodes/${encodeURIComponent(profile.node)}/version` }
  }

  /** Clone request: derive a new worker from the approved profile. */
  cloneRequest(runId: string, profile: WorkerProfile): ProxmoxRequest {
    return {
      method: 'POST',
      path: pathFor(profile.node, profile.id, 'clone'),
      body: { target: 'worker-' + runId, full: false, name: profile.imageDigest.slice(7, 13) },
    }
  }

  /** Start request: bring a provisioned worker online. */
  startRequest(runId: string, profile: WorkerProfile): ProxmoxRequest {
    return {
      method: 'POST',
      path: pathFor(profile.node, runId, 'start'),
      body: { start: '1' },
    }
  }

  /**
   * Destroy request. Construction itself is gated on a caller-provided terminal receipt
   * so the caller cannot issue a teardown without an explicit terminal lifecycle state.
   * The node/run target comes from the approved profile.
   */
  destroyRequest(profile: WorkerProfile, terminalReceipt: WorkerReceipt): ProxmoxRequest {
    this.assertTerminal(terminalReceipt)
    return {
      method: 'DELETE',
      path: pathFor(profile.node, terminalReceipt.runId, 'stop'),
      body: { stop: '1' },
    }
  }

  /** Resolve the scoped token and dispatch; returns the transport response. */
  async send<T>(runId: string, profile: WorkerProfile, request: ProxmoxRequest): Promise<ProxmoxResponse<T>> {
    const token = await this.resolve(profile, runId)
    const response = await this.#transport.send<T>({ ...request, path: this.#root + request.path }, token)
    if (!response.ok) throw new Error(`Proxmox ${request.method} ${request.path} failed with ${response.status}`)
    return response
  }

  async version(profile: WorkerProfile): Promise<ProxmoxResponse> {
    return this.send('version', profile, this.versionRequest(profile))
  }

  async clone(runId: string, profile: WorkerProfile): Promise<ProxmoxResponse> {
    return this.send(runId, profile, this.cloneRequest(runId, profile))
  }

  async start(runId: string, profile: WorkerProfile): Promise<ProxmoxResponse> {
    return this.send(runId, profile, this.startRequest(runId, profile))
  }

  async destroy(runId: string, profile: WorkerProfile, terminalReceipt: WorkerReceipt): Promise<ProxmoxResponse> {
    if (terminalReceipt.runId !== runId) throw new Error('Destroy terminal receipt run mismatch.')
    return this.send(runId, profile, this.destroyRequest(profile, terminalReceipt))
  }

  private assertTerminal(receipt: WorkerReceipt): void {
    if (!TERMINAL_STATES.has(receipt.state)) {
      throw new Error('Destroy requires a caller-provided terminal receipt state (lost, returned, or destroyed).')
    }
  }
}
