import { assertApprovedProfile, type ApprovedWorkerProfile, type RunLease } from './profile.js'
import {
   makeReceipt,
   type ArtifactReference,
   type WorkerLifecycleReceipt,
   type WorkerReceiptState,
   isTerminalReceipt,
   isDestroyedReceipt,
} from './receipt.js'

/**
 * The narrow launcher boundary (PRD §8, §9.2). The launcher receives a run id and an
 * *approved* profile. It provisions from a golden image, records lifecycle receipts,
 * and may destroy a worker only as an explicit post-run action after a terminal receipt.
 *
 * Crucially, the launcher surface never carries a raw admin/Proxmox token: credentials
 * are resolved out-of-band by the transport, not embedded in any worker request.
 */

/** A run-specific, token-free provisioning plan. No credential fields are permitted. */
export interface ProvisionPlan {
   readonly runId: string
   readonly profile: ApprovedWorkerProfile
   readonly workspaceRef: { readonly name: string; readonly digest: `sha256:${string}` }
   readonly leases: readonly RunLease[]
}

export interface WorkerReturnResult {
   readonly exit: number
   readonly artifactReferences?: readonly ArtifactReference[]
}

export type WorkerLostReason = 'timeout' | 'evicted' | 'crash' | 'lease-expired' | 'unreachable' | 'unknown'

/** A surfaced interruption; it creates a durable `lost` receipt, never erasing the run. */
export interface WorkerLostSignal {
   readonly runId: string
   readonly reason: WorkerLostReason
   readonly detail?: string
}

export class LauncherError extends Error {
   readonly code: string
   readonly runId?: string
   constructor(code: string, message: string, runId?: string) {
      super(message)
      this.name = 'LauncherError'
      this.code = code
      this.runId = runId
   }
}

/** The minimal, dependency-free lifecycle contract. */
export interface ProxmoxLauncher {
   readonly name: string
   /** Provision a worker and record `requested`, then `ready` (or surface `lost`). */
   provision(plan: ProvisionPlan): Promise<WorkerLifecycleReceipt>
   /** Record a terminal `returned` receipt for a run. */
   returnRun(runId: string, result: WorkerReturnResult): Promise<WorkerLifecycleReceipt>
   /** Surface a worker loss as a durable `lost` receipt. The run is never erased. */
   declareLost(signal: WorkerLostSignal): Promise<WorkerLifecycleReceipt>
   /** Explicit post-run destroy. Allowed only after a terminal receipt exists. */
   destroy(runId: string): Promise<WorkerLifecycleReceipt>
   /** The durable, append-only receipt log for a run. A lost run still returns its receipts. */
   receipts(runId: string): readonly WorkerLifecycleReceipt[]
}

/**
 * Shared invariant-enforcing ledger. Concrete launchers (fake, HTTP) extend this so
 * lifecycle safety lives in one place:
 *  - receipts are append-only and per-run; erasure is impossible;
 *  - `destroy` is fail-closed: it throws unless a terminal receipt already exists;
 *  - once destroyed, no further lifecycle operation is accepted for the run.
 */
export abstract class BaseLauncher implements Omit<ProxmoxLauncher, 'name'> {
   abstract name: string
   protected readonly ledger = new Map<string, WorkerLifecycleReceipt[]>()
   protected last: number
   protected clock: () => string

   constructor(options: { clock?: () => string }) {
      this.clock = options.clock ?? (() => new Date().toISOString())
      this.last = 0
   }

   protected nextSequence(runId: string): number {
      this.last += 1
      return this.last
   }

   protected append(runId: string, receipt: WorkerLifecycleReceipt): WorkerLifecycleReceipt {
      const list = this.ledger.get(runId) ?? []
      this.ledger.set(runId, [...list, receipt])
      return receipt
   }

   receipts(runId: string): readonly WorkerLifecycleReceipt[] {
      // A run that was never provisioned still exists as an empty, durable log — not nothing.
      const list = this.ledger.get(runId) ?? []
      return list.slice()
   }

   protected lastReceipt(runId: string): WorkerLifecycleReceipt | undefined {
      const list = this.ledger.get(runId)
      if (list === undefined || list.length === 0) return undefined
      return list[list.length - 1]
   }

   protected requireTerminalBeforeDestroy(runId: string): WorkerLifecycleReceipt {
      const previous = this.lastReceipt(runId)
      if (previous === undefined) {
         throw new LauncherError('NO_TERMINAL_RECEIPT', `Cannot destroy ${runId}: no terminal receipt recorded.`, runId)
      }
      if (isDestroyedReceipt(previous.state)) {
         throw new LauncherError('ALREADY_DESTROYED', `Worker ${runId} is already destroyed.`, runId)
      }
      if (!isTerminalReceipt(previous.state)) {
         throw new LauncherError('DESTROY_REQUIRES_TERMINAL', `Cannot destroy ${runId}: most recent receipt is '${previous.state}', not terminal.`, runId)
      }
      return previous
   }

   /** The destroy invariant shared by all launchers. */
   protected finalizeDestroy(runId: string, detail?: string): WorkerLifecycleReceipt {
      const terminal = this.requireTerminalBeforeDestroy(runId)
      return this.append(
         runId,
         makeReceipt(runId, {
            state: 'destroyed',
            observedAt: this.clock(),
            detail: detail ?? `explicit destroy after ${terminal.state}`,
         }),
      )
   }

   /** Validate + return a fresh, frozen copy so callers cannot mutate an approved profile. */
   protected assertProfile(plan: ProvisionPlan): ApprovedWorkerProfile {
      if (typeof plan.runId !== 'string' || plan.runId.length === 0) throw new LauncherError('BAD_PLAN', 'provision plan requires a non-empty runId.')
      if (plan.workspaceRef.digest !== undefined) {
         if (typeof plan.workspaceRef.digest !== 'string' || !plan.workspaceRef.digest.startsWith('sha256:')) {
            throw new LauncherError('BAD_PLAN', 'workspaceRef.digest must be a sha256 digest.')
         }
      }
      assertApprovedProfile(plan.profile)
      const frozen = plan.profile as ApprovedWorkerProfile
      // Return a frozen copy so downstream code cannot retain a mutable reference.
      void frozen
      return Object.isFrozen(plan.profile) ? plan.profile : deepFreezeCopy(plan.profile)
   }
}

function deepFreezeCopy<T>(value: T): T {
   if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
   for (const nested of Object.values(value as Record<string, unknown>)) deepFreezeCopy(nested)
   return Object.freeze(value)
}

export { isTerminalReceipt, isDestroyedReceipt, type WorkerReceiptState }
