export type LifecycleState = 'requested' | 'ready' | 'lost' | 'returned' | 'destroyed'

export interface WorkerProfile {
  readonly id: string
  readonly imageDigest: `sha256:${string}`
  readonly compositionDigest: `sha256:${string}`
  readonly pool: 'builder-arms'
  readonly node: string
}

export interface WorkerReceipt {
  readonly runId: string
  readonly state: LifecycleState
  readonly observedAt: string
  readonly detail: string
}

export interface ProxmoxLauncher {
  provision(runId: string, profile: WorkerProfile): Promise<readonly WorkerReceipt[]>
  declareLost(runId: string, detail: string): Promise<WorkerReceipt>
  returnRun(runId: string, detail: string): Promise<WorkerReceipt>
  destroy(runId: string): Promise<WorkerReceipt>
}

export function validateProfile(profile: WorkerProfile): WorkerProfile {
  if (!profile.id || profile.pool !== 'builder-arms' || !profile.node || !profile.imageDigest.startsWith('sha256:') || !profile.compositionDigest.startsWith('sha256:')) {
    throw new TypeError('Worker profile must be an approved builder-arms profile with pinned digests.')
  }
  return Object.freeze({ ...profile })
}

/** Test-only adapter: production credentials and HTTP are deliberately outside worker requests. */
export class FakeProxmoxLauncher implements ProxmoxLauncher {
  #receipts = new Map<string, WorkerReceipt[]>()
  async provision(runId: string, profile: WorkerProfile): Promise<readonly WorkerReceipt[]> {
    validateProfile(profile)
    if (this.#receipts.has(runId)) throw new Error('Run already has lifecycle receipts.')
    const requested = { runId, state: 'requested' as const, observedAt: 'synthetic', detail: profile.id }
    const ready = { runId, state: 'ready' as const, observedAt: 'synthetic', detail: profile.node }
    this.#receipts.set(runId, [requested, ready])
    return this.#receipts.get(runId)!
  }
  async declareLost(runId: string, detail: string): Promise<WorkerReceipt> { return this.#terminal(runId, 'lost', detail) }
  async returnRun(runId: string, detail: string): Promise<WorkerReceipt> { return this.#terminal(runId, 'returned', detail) }
  async destroy(runId: string): Promise<WorkerReceipt> {
    const receipts = this.#require(runId)
    if (!receipts.some(receipt => receipt.state === 'lost' || receipt.state === 'returned')) throw new Error('Destroy requires an explicit terminal receipt.')
    const receipt = { runId, state: 'destroyed' as const, observedAt: 'synthetic', detail: 'explicit lifecycle action' }
    receipts.push(receipt); return receipt
  }
  #terminal(runId: string, state: 'lost' | 'returned', detail: string): WorkerReceipt {
    const receipts = this.#require(runId)
    const receipt = { runId, state, observedAt: 'synthetic', detail }; receipts.push(receipt); return receipt
  }
  #require(runId: string): WorkerReceipt[] { const receipts = this.#receipts.get(runId); if (!receipts) throw new Error('Unknown run.'); return receipts }
}
