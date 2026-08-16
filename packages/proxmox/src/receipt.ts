import { canonicalJson, digestCanonical, type CanonicalJson, type Sha256Digest } from './digest.js'

/**
 * Lifecycle receipts (PRD §9.2). A worker run is a durable log of receipts, never a
 * live VM status. A lost or destroyed worker must leave a receipt behind so the run
 * (and any evidence it produced) survives the worker.
 */

export type WorkerReceiptState = 'requested' | 'ready' | 'lost' | 'returned' | 'destroyed'

export interface ArtifactReference {
   readonly digest: Sha256Digest
   readonly mediaType: string
   readonly uri: string
}

export interface WorkerLifecycleReceipt {
   readonly id: string
   readonly runId: string
   readonly state: WorkerReceiptState
   readonly observedAt: string
   /** Opaque, canonical cause/detail record; never carries a token. */
   readonly detail?: string
   /** Terminal/return receipts may reference the worker's durable output. */
   readonly artifactReferences?: readonly ArtifactReference[]
   /** Digest of the receipt body (everything except id/runId) for tamper-evidence. */
   readonly bodyDigest: Sha256Digest
}

/** Receipts that end the worker's useful life. Destroy is only allowed after one. */
export const TERMINAL_RECEIPT_STATES = ['lost', 'returned'] as const
export type TerminalReceiptState = (typeof TERMINAL_RECEIPT_STATES)[number]

export function isTerminalReceipt(state: WorkerReceiptState): state is TerminalReceiptState {
   return state === 'lost' || state === 'returned'
}

export function isDestroyedReceipt(state: WorkerReceiptState): state is 'destroyed' {
   return state === 'destroyed'
}

function digestParts(state: WorkerReceiptState, observedAt: string, detail: string | undefined, artifacts: readonly ArtifactReference[] | undefined): Sha256Digest {
   return digestCanonical({
      state,
      observedAt,
      detail: detail ?? null,
      artifactReferences: artifacts ?? [],
   } as CanonicalJson)
}

export interface ReceiptInput {
   readonly runId: string
   readonly state: WorkerReceiptState
   readonly observedAt: string
   readonly detail?: string
   readonly artifactReferences?: readonly ArtifactReference[]
}

/**
 * Build an immutable receipt. The id is deterministic from the run, state and
 * observed timestamp so the same lifecycle event is always the same receipt.
 */
export function makeReceipt(runId: string, input: ReceiptInput): WorkerLifecycleReceipt {
   if (typeof runId !== 'string' || runId.length === 0) throw new TypeError('Receipt requires a non-empty runId.')
   if (!TERMINAL_RECEIPT_STATES.includes(input.state as string) && input.state !== 'requested' && input.state !== 'ready' && input.state !== 'destroyed') {
      throw new TypeError(`Unknown receipt state: ${String(input.state)}`)
   }
   const observedAt: string = input.observedAt
   const detail = input.detail
   const artifacts = input.artifactReferences
   const bodyDigest = digestParts(input.state, observedAt, detail, artifacts)
   const id = `rcpt:${runId}:${input.state}:${observedAt}:${bodyDigest.slice('sha256:'.length, 'sha256:'.length + 12)}`
   const receipt: WorkerLifecycleReceipt = {
      id,
      runId,
      state: input.state,
      observedAt,
      artifactReferences: artifacts,
      bodyDigest,
   }
   if (detail !== undefined) receipt.detail = detail
   return Object.freeze(receipt)
}

export { canonicalJson }
