import { assertApprovedProfile, type ApprovedWorkerProfile, type RunLease } from './profile.js'
import { makeReceipt, type ArtifactReference, type WorkerLifecycleReceipt } from './receipt.js'
import {
   BaseLauncher,
   type ProxmoxLauncher,
   type ProvisionPlan,
   type WorkerLostReason,
   type WorkerLostSignal,
   type WorkerReturnResult,
   LauncherError,
} from './launcher.js'

/**
 * HTTP adapter boundary.
 *
 * SECURITY INVARIANT: a *worker request* (the token-free payload routed to a Proxmox
 * worker) must never carry a raw admin credential. The Proxmox ticket is resolved
 * out-of-band by a {@link ProxmoxTokenSource} and delivered to the transport as a
 * separate credential scope. It is structurally impossible for the token to reach the
 * request body, and any attempt to smuggle credential-shaped material into the request
 * is detected by {@link assertTokenFree} and fails closed.
 */

export type ProxmoxTicket = string

/** Out-of-band credential channel (e.g. a credential broker). Never part of a request. */
export interface ProxmoxTokenSource {
   resolve(): Promise<ProxmoxTicket>
}

/** Reserved credential field names that may never appear in a worker request. */
export const RESERVED_CREDENTIAL_KEYS = ['api', 'apikey', 'authorization', 'auth', 'credential', 'credentials', 'password', 'pw', 'secret', 'ticket', 'token'] as const

/**
 * Proxmox API-token / session-ticket value shapes. A request value matching one of
 * these is treated as a leaked credential and rejected. Conservative by design.
 */
export const CREDENTIAL_VALUE_SHAPES: readonly RegExp[] = [
    /^pveapi:/i, // PVEAPI:<user!realm!tokenid> long-lived token
    /!pve:[.0-9]+/i, // session ticket: <user>!pve:<nonce>
    /^[.:0-9a-f]{40,}$/i, // an opaque hex/colon credential blob
]

function hasCredentialKeyName(key: string): boolean {
   const lower = key.toLowerCase()
   return RESERVED_CREDENTIAL_KEYS.some((reserved) => lower === reserved || lower.includes(reserved))
}

function valueLooksLikeCredential(value: string): boolean {
   return CREDENTIAL_VALUE_SHAPES.some((shape) => shape.test(value))
}

/**
 * Fail-closed guard. Reject any object/structure that carries a credential-shaped key
 * or value. This is what keeps a raw admin token out of a worker request even when a
 * caller tries to embed one.
 */
export function assertTokenFree(payload: unknown, path = 'request'): void {
   if (typeof payload === 'string') {
      if (valueLooksLikeCredential(payload)) throw new LauncherError('TOKEN_IN_REQUEST', `Credential-shaped value detected at ${path}.`)
      return
    }
   if (Array.isArray(payload)) {
      payload.forEach((entry, index) => assertTokenFree(entry, `${path}[${index}]`))
      return
    }
   if (payload !== null && typeof payload === 'object') {
      for (const [key, value] of Object.entries(payload)) {
         if (hasCredentialKeyName(key)) {
            throw new LauncherError('TOKEN_IN_REQUEST', `Credential field '${key}' is not permitted in a worker request (${path}).`)
            }
         assertTokenFree(value, `${path}.${key}`)
      }
   }
}

/** A single token-free HTTP request for the launcher boundary. */
export interface WorkerHttpRequest {
   readonly method: 'GET' | 'POST' | 'DELETE'
   readonly path: string
   readonly query: ReadonlyArray<readonly [string, string]>
   readonly body?: unknown
}

/** Credentials, delivered *separately* from the request. */
export interface TokenScope {
   readonly ticket: ProxmoxTicket
}

/** The transport is responsible for attaching the ticket to the HTTP layer only. */
export interface ProxmoxTransport {
   execute(request: WorkerHttpRequest, credentials: TokenScope): Promise<WorkerHttpResponse>
}

export interface WorkerHttpResponse {
   readonly status: number
   readonly body?: unknown
}

type WorkerRequestKind = 'provision' | 'return' | 'lost' | 'destroy' | 'status'

export interface ProxmoxHttpAdapterOptions {
   readonly name?: string
   readonly transport: ProxmoxTransport
   readonly tokenSource: ProxmoxTokenSource
   readonly clock?: () => string
   readonly requestBuilder?: (
      kind: WorkerRequestKind,
      runId: string,
      plan: ProvisionPlan | undefined,
      result: WorkerReturnResult | undefined,
      signal: WorkerLostSignal | undefined,
   ) => WorkerHttpRequest
}

const DEFAULT_PATH = {
   provision: (runId: string) => `/cluster/worker-runs/${encodeURIComponent(runId)}/provision`,
   return: (runId: string) => `/cluster/worker-runs/${encodeURIComponent(runId)}/return`,
   lost: (runId: string) => `/cluster/worker-runs/${encodeURIComponent(runId)}/lost`,
   destroy: (runId: string) => `/cluster/worker-runs/${encodeURIComponent(runId)}/destroy`,
}

/**
 * Build the token-free provision body. This is an allow-list projection: only known
 * run/profile fields are serialized, so no token the profile did not declare can leak.
 */
export function provisionBody(plan: ProvisionPlan): Record<string, unknown> {
   const profile = plan.profile
   assertApprovedProfile(profile)
   const leases: RunLease[] = plan.leases
   return {
      runId: plan.runId,
      workspaceRef: { name: plan.workspaceRef.name, digest: plan.workspaceRef.digest },
      profile: {
         id: profile.id,
         imageDigest: profile.imageDigest,
         compositionDigest: profile.execution.compositionDigest,
         lifecycle: profile.lifecycle,
      },
      leases: leases.map((lease) => ({ kind: lease.kind, scope: lease.scope, expiresAt: lease.expiresAt })),
   }
}

function defaultRequest(kind: WorkerRequestKind, runId: string): WorkerHttpRequest {
   const path =
      kind === 'return' ? DEFAULT_PATH.return(runId)
      : kind === 'lost' ? DEFAULT_PATH.lost(runId)
      : kind === 'destroy' ? DEFAULT_PATH.destroy(runId)
      : DEFAULT_PATH.provision(runId)
   const method = kind === 'status' ? 'GET' : 'POST'
   return { method, path, query: [] }
}

/**
 * HTTP-backed launcher. Every worker request is built, asserted token-free, and sent;
 * the resolved Proxmox ticket is delivered only through the transport's credential
 * scope. A transport failure for a provision surfaces as a durable `lost` receipt
 * rather than erasing the run.
 */
export class ProxmoxHttpAdapter extends BaseLauncher implements ProxmoxLauncher {
   readonly name: string
   private readonly transport: ProxmoxTransport
   private readonly tokenSource: ProxmoxTokenSource
   private readonly build: (
      kind: WorkerRequestKind,
      runId: string,
      plan: ProvisionPlan | undefined,
      result: WorkerReturnResult | undefined,
      signal: WorkerLostSignal | undefined,
   ) => WorkerHttpRequest

   constructor(options: ProxmoxHttpAdapterOptions) {
      super({ clock: options.clock })
      this.name = options.name ?? 'proxmox-http'
      this.transport = options.transport
      this.tokenSource = options.tokenSource
      this.build =
         options.requestBuilder ??
          ((kind: WorkerRequestKind, runId: string, plan: ProvisionPlan | undefined, result: WorkerReturnResult | undefined, signal: WorkerLostSignal | undefined): WorkerHttpRequest => {
            const request = defaultRequest(kind, runId)
            let body: unknown
            if (kind === 'provision' && plan !== undefined) body = provisionBody(plan)
            else if (kind === 'return' && result !== undefined) body = { exit: result.exit, artifactReferences: result.artifactReferences ?? [] }
            else if (kind === 'lost' && signal !== undefined) body = { reason: signal.reason, detail: signal.detail ?? null }
            else body = { runId }
            const completed = { ...request, body }
             // Enforce the token-free invariant on the exact request that would be sent.
            assertTokenFree(completed)
            return completed
          })
    }

   private async send(
      kind: WorkerRequestKind,
      runId: string,
      plan?: ProvisionPlan,
      result?: WorkerReturnResult,
      signal?: WorkerLostSignal,
   ): Promise<WorkerHttpResponse> {
      const request = this.build(kind, runId, plan, result, signal)
       // The request itself must be credential-free before anything is sent.
      assertTokenFree(request)
      const ticket = await this.tokenSource.resolve()
       // The ticket is delivered as a separate credential scope, never merged into request.
      const response = await this.transport.execute(request, { ticket })
      assertTokenFree(request) // belt-and-suspenders: it must still be token-free after transport
      return response
   }

   async provision(plan: ProvisionPlan): Promise<WorkerLifecycleReceipt> {
      const profile = this.assertProfile(plan)
      this.append(plan.runId, makeReceipt(plan.runId, { state: 'requested', observedAt: this.clock(), detail: `provision from ${profile.imageDigest}` }))
      try {
         const response = await this.send('provision', plan.runId, plan)
         if (response.status < 200 || response.status >= 300) {
            throw new LauncherError('PROVISION_FAILED', `Provisioning returned HTTP ${response.status}.`, plan.runId)
            }
         return this.append(plan.runId, makeReceipt(plan.runId, { state: 'ready', observedAt: this.clock(), detail: 'worker registered' }))
      } catch (err) {
         // Unavailability is a durable interruption, never erasure of the run.
         const code = (err as { code?: string })?.code
         const reason: WorkerLostReason = code === 'PROVISION_FAILED' ? 'unreachable' : 'unknown'
         return this.append(plan.runId, makeReceipt(plan.runId, { state: 'lost', observedAt: this.clock(), detail: `provision lost (${reason}): ${err instanceof Error ? err.message : String(err)}` }))
      }
   }

   async returnRun(runId: string, result: WorkerReturnResult): Promise<WorkerLifecycleReceipt> {
      if (!this.ledger.has(runId)) throw new LauncherError('UNKNOWN_RUN', `No worker run '${runId}'.`, runId)
      const last = this.lastReceipt(runId)
      if (last === undefined) throw new LauncherError('NO_LIFECYCLE', `Run '${runId}' has no lifecycle to return.`, runId)
      if (last.state === 'destroyed') throw new LauncherError('ALREADY_DESTROYED', `Worker ${runId} is already destroyed.`, runId)
      await this.send('return', runId, undefined, result)
      return this.append(
         runId,
         makeReceipt(runId, {
            state: 'returned',
            observedAt: this.clock(),
            detail: `worker returned exit=${result.exit}`,
            artifactReferences: result.artifactReferences,
         }),
      )
   }

   async declareLost(signal: WorkerLostSignal): Promise<WorkerLifecycleReceipt> {
      if (!this.ledger.has(signal.runId)) throw new LauncherError('UNKNOWN_RUN', `No worker run '${signal.runId}'.`, signal.runId)
      await this.send('lost', signal.runId, undefined, undefined, signal)
      return this.append(signal.runId, makeReceipt(signal.runId, { state: 'lost', observedAt: this.clock(), detail: `lost: ${signal.reason}` }))
   }

   async destroy(runId: string): Promise<WorkerLifecycleReceipt> {
      this.requireTerminalBeforeDestroy(runId)
      await this.send('destroy', runId)
      return this.finalizeDestroy(runId)
   }
}

export type { ProxmoxLauncher, ProvisionPlan, WorkerReturnResult, WorkerLostSignal, WorkerLostReason, ArtifactReference }
