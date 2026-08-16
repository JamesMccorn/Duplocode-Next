import type { Evidence, Run, Verdict } from '@duplocode/contracts'

/**
 * Deterministic, in-memory repository ports. These carry no clock, no randomness,
 * and no I/O: given the same inserts in the same order they reproduce the same
 * observations. `Map` preserves insertion order, so `list()` is stable.
 */

export interface RunRepository {
  readonly kind: 'run'
  put(run: Run): void
  get(id: string): Run | undefined
  list(): readonly Run[]
}

export interface EvidenceRepository {
  readonly kind: 'evidence'
  put(evidence: Evidence): void
  get(id: string): Evidence | undefined
  list(): readonly Evidence[]
}

export interface VerdictRepository {
  readonly kind: 'verdict'
    /** Verdicts are addressed by the evidence id they are bound to. */
  put(verdict: Verdict): void
  get(evidenceId: string): Verdict | undefined
  list(): readonly Verdict[]
}

/**
 * The approval ledger of trusted verifier ids. The service only trusts evidence
 * whose verifier is present here; its `approvedVerifierIds` set is the single
 * authority passed to `checkDecisivePass`.
 */
export interface ApprovalRepository {
  readonly kind: 'approval'
  readonly approvedVerifierIds: ReadonlySet<string>
}

export function createMemoryRunRepository(): RunRepository {
  const runs = new Map<string, Run>()
  return {
    kind: 'run',
    put(run) {
        // Defensive copy so a stored run cannot be mutated by the caller.
      runs.set(run.id, {
        ...run,
        composition: { ...run.composition, pluginDigests: { ...run.composition.pluginDigests } }
        })
      return void 0
      },
    get(id) {
      return runs.get(id)
      },
    list() {
      return [...runs.values()]
      }
    }
}

export function createMemoryEvidenceRepository(): EvidenceRepository {
  const entries = new Map<string, Evidence>()
  return {
    kind: 'evidence',
    put(entry) {
      entries.set(entry.id, {
        ...entry,
        artifactReferences: [...entry.artifactReferences],
        receiptIds: [...entry.receiptIds]
        })
      return void 0
      },
    get(id) {
      return entries.get(id)
      },
    list() {
      return [...entries.values()]
      }
    }
}

export function createMemoryVerdictRepository(): VerdictRepository {
  const verdicts = new Map<string, Verdict>()
  return {
    kind: 'verdict',
    put(verdict) {
      verdicts.set(verdict.evidenceId, { ...verdict })
      return void 0
      },
    get(evidenceId) {
      return verdicts.get(evidenceId)
      },
    list() {
      return [...verdicts.values()]
      }
    }
}

export function createMemoryApprovalRepository(approvedVerifierIds: readonly string[] = []): ApprovalRepository {
    // Membership is authoritative and deterministic: fixed at construction and
    // never mutated, so approvals are a closed, inspectable input.
  return {
    kind: 'approval',
    approvedVerifierIds: new Set(approvedVerifierIds)
    }
}
