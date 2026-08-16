import {
   BaseLauncher,
   type ProxmoxLauncher,
   type ProvisionPlan,
   type WorkerLostSignal,
   type WorkerReturnResult,
   LauncherError,
} from './launcher.js'
import { makeReceipt, type WorkerLifecycleReceipt } from './receipt.js'

/**
 * A deterministic, in-memory {@link ProxmoxLauncher} for tests. No network, no wall
 * clock: timestamps come from an injected clock and the same inputs always produce the
 * same sequence of receipts. Outcomes are fully scripted and inspectable.
 */
export interface FakeProxmoxLauncherOptions {
   /** Fixed clock. Defaults to a monotonic, sequence-driven timestamp (deterministic). */
   readonly clock?: () => string
}

export class FakeProxmoxLauncher extends BaseLauncher implements ProxmoxLauncher {
   readonly name = 'proxmox-fake'

    /** Every HTTP-equivalent request the launcher attempted to send, recorded for assertions. */
   readonly sent = [] as Array<{ kind: string; runId: string; body?: unknown }>

   constructor(options: FakeProxmoxLauncherOptions = {}) {
      let counter = 0
      super({ clock: options.clock ?? (() => `t${(counter += 1)}`) })
    }

   private record(kind: string, runId: string, body?: unknown): void {
      this.sent.push({ kind, runId, body })
   }

   async provision(plan: ProvisionPlan): Promise<WorkerLifecycleReceipt> {
      const profile = this.assertProfile(plan)
      this.record('provision', plan.runId, { imageDigest: profile.imageDigest, compositionDigest: profile.execution.compositionDigest })
      this.append(plan.runId, makeReceipt(plan.runId, { state: 'requested', observedAt: this.clock(), detail: `provision from ${profile.imageDigest}` }))
      return this.append(plan.runId, makeReceipt(plan.runId, { state: 'ready', observedAt: this.clock(), detail: 'worker registered' }))
    }

   async returnRun(runId: string, result: WorkerReturnResult): Promise<WorkerLifecycleReceipt> {
      if (!this.ledger.has(runId)) throw new LauncherError('UNKNOWN_RUN', `No worker run '${runId}'.`, runId)
      const last = this.lastReceipt(runId)
      if (last === undefined) throw new LauncherError('NO_LIFECYCLE', `Run '${runId}' has no lifecycle to return.`, runId)
      if (last.state === 'destroyed') throw new LauncherError('ALREADY_DESTROYED', `Worker ${runId} is already destroyed.`, runId)
      this.record('return', runId, { exit: result.exit })
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
      this.record('lost', signal.runId, { reason: signal.reason })
      return this.append(signal.runId, makeReceipt(signal.runId, { state: 'lost', observedAt: this.clock(), detail: `lost: ${signal.reason}` }))
   }

   async destroy(runId: string): Promise<WorkerLifecycleReceipt> {
      this.requireTerminalBeforeDestroy(runId)
      this.record('destroy', runId, { runId })
      return this.finalizeDestroy(runId)
    }
}
