import type {
   ArtifactReference,
   Evidence,
   IsoTimestamp,
   PublicationDecision,
   Run,
   Sha256Digest,
   Verdict,
   VerdictKind,
   WorkProposal
} from '@duplocode/contracts'
import { checkDecisivePass } from '@duplocode/contracts'
import { digestRunComposition, type CanonicalJson, type RunCompositionManifest } from '@duplocode/composition'
import type { ApprovalRepository, EvidenceRepository, RunRepository, VerdictRepository } from './ports.js'
import { IllegalTransitionError, assertLegalTransition } from './transitions.js'

/** Fixed clock. The service never reads wall time by default, keeping runs reproducible. */
const DETERMINISTIC_NOW = (): IsoTimestamp => '1970-01-01T00:00:00.000Z'

/**
 * Sentinel attestation recorded on a *denied* decision. It is never a real
 * control-plane attestation and never authorizes anything; it only satisfies the
 * required shape of `PublicationDecision` when no genuine attestation was supplied.
 */
const DENIAL_ATTESTATION: ArtifactReference = {
  digest: `sha256:${'0'.repeat(64)}`,
  mediaType: 'application/duplocode-attestation+json',
  uri: 'attestations/:unavailable'
}

const PUBLISH_PRE_STATES: readonly Run['state'][] = ['verifying', 'needs-attention', 'published']

export interface RunServiceConfig {
  readonly runs: RunRepository
  readonly evidence: EvidenceRepository
  readonly verdicts: VerdictRepository
  readonly approvals: ApprovalRepository
      /** Override the clock for non-deterministic callers; defaults to a fixed instant. */
  readonly now?: () => IsoTimestamp
}

export interface AdmissionOptions {
      /** If supplied, admission fails closed unless the closed manifest digests to this value. */
  readonly expectedCompositionDigest?: Sha256Digest
      /** Override the deterministic default run id `run-${proposal.id}`. */
  readonly runId?: string
}

export interface PublicationInput {
  readonly runId: string
       /** Evidence to consider decisive. Omission or a missing entry is "unavailable". */
  readonly evidenceId?: string
       /**
        * Separately signed control-plane attestation. The service never produces or
        * verifies its signature; it only requires a well-formed attestation reference
        * to be supplied for any authorized publication.
       */
  readonly attestation: ArtifactReference
  readonly issuer: string
       /** Policy version stamped on the decision; defaults to the run's policy. */
  readonly policyVersion?: string
}

export type PublicationOutcome =
        | { readonly kind: 'authorized'; readonly decision: PublicationDecision; readonly run: Run }
        | {
         readonly kind: 'needs-attention'
        readonly decision: PublicationDecision
        readonly run: Run
        readonly verdict: Verdict
          }
        | {
         readonly kind: 'refused'
        readonly decision: PublicationDecision
        readonly run: Run
        readonly verdict: Verdict
          }

export interface RunService {
  admit(proposal: WorkProposal, options?: AdmissionOptions): Run
  hasRun(runId: string): boolean
  getRun(runId: string): Run | undefined
  applyTransition(runId: string, to: Run['state']): Run
  recordEvidence(evidence: Evidence): void
  recordVerdict(verdict: Verdict): void
  attemptPublication(input: PublicationInput): PublicationOutcome
}

function isWellFormedArtifact(reference: ArtifactReference | undefined): reference is ArtifactReference {
  if (reference === undefined) return false
  if (!/^sha256:[0-9a-f]{64}$/.test(reference.digest)) return false
  if (reference.uri.length === 0 || reference.mediaType.length === 0) return false
  return true
}

/**
 * Build the closed admission-time manifest and digest it. `digestRunComposition`
 * rejects unknown or missing top-level keys, so the resulting digest binds the
 * entire composition closure (commit + execution composition + schema version).
 */
function closedManifestDigest(proposal: WorkProposal): Sha256Digest {
  const manifest = {
    schemaVersion: 1,
    repositoryCommit: proposal.repositoryCommit,
    executionComposition: proposal.requestedComposition as unknown as CanonicalJson
      } satisfies RunCompositionManifest
  return digestRunComposition(manifest)
}

export function createRunService(config: RunServiceConfig): RunService {
  const now = config.now ?? DETERMINISTIC_NOW
  const approvedVerifierIds = config.approvals.approvedVerifierIds

  function transition(run: Run, to: Run['state']): Run {
    assertLegalTransition(run.state, to)
    const updated: Run = { ...run, state: to }
    config.runs.put(updated)
    return updated
    }

  return {
    admit(proposal, options = {}) {
      const digest = closedManifestDigest(proposal)
      if (options.expectedCompositionDigest !== undefined && options.expectedCompositionDigest !== digest) {
        throw new Error(
          `Admission refused: composition digest ${digest} does not match expected ${options.expectedCompositionDigest}.`
          )
        }
      const runId = options.runId ?? `run-${proposal.id}`
      if (config.runs.get(runId) !== undefined) {
        throw new Error(`Admission refused: run ${runId} has already been admitted.`)
        }
      const run: Run = {
        id: runId,
        proposalId: proposal.id,
        projectId: proposal.projectId,
        issueRef: proposal.issueRef,
        repositoryCommit: proposal.repositoryCommit,
        composition: {
          ...proposal.requestedComposition,
          pluginDigests: { ...proposal.requestedComposition.pluginDigests }
            },
        compositionDigest: digest,
        state: 'admitted',
        admittedAt: now()
         }
      config.runs.put(run)
      return run
       },

    hasRun(runId) {
      return config.runs.get(runId) !== undefined
       },

    getRun(runId) {
      return config.runs.get(runId)
       },

    applyTransition(runId, to) {
      const run = config.runs.get(runId)
      if (run === undefined) throw new ReferenceError(`Unknown run ${runId}`)
      return transition(run, to)
       },

    recordEvidence(evidence) {
      config.evidence.put(evidence)
      return void 0
       },

    recordVerdict(verdict) {
      config.verdicts.put(verdict)
      return void 0
       },

    attemptPublication(input) {
      const foundRun = config.runs.get(input.runId)
      if (foundRun === undefined) throw new ReferenceError(`Unknown run ${input.runId}`)
      const run: Run = foundRun

          // Publication is only legal from a state that has reached or recovered from
          // verification; any other state fails closed.
      if (!PUBLISH_PRE_STATES.includes(run.state)) throw new IllegalTransitionError(run.state, 'published')

      const policyVersion = input.policyVersion ?? run.composition.policyVersion
      const attestation = isWellFormedArtifact(input.attestation) ? input.attestation : undefined

      function deny(
          next: Extract<Run['state'], 'needs-attention' | 'refused'>,
          verdict: Verdict,
          reason: string,
          decisiveEvidenceIds: readonly string[]
            ): PublicationOutcome {
        config.verdicts.put(verdict)
        const nextRun = transition(run, next)
        const decision: PublicationDecision = {
          runId: run.id,
          authorized: false,
          policyVersion,
          decisiveEvidenceIds,
          issuer: input.issuer,
          attestation: attestation ?? DENIAL_ATTESTATION,
          decidedAt: now(),
          reason
           }
        if (next === 'needs-attention') return { kind: 'needs-attention', decision, run: nextRun, verdict }
        return { kind: 'refused', decision, run: nextRun, verdict }
         }

          // Case A: evidence unavailable (omitted or not recorded).
      const evidence = input.evidenceId === undefined ? undefined : config.evidence.get(input.evidenceId)
      if (evidence === undefined) {
        return deny(
          'needs-attention',
          { evidenceId: input.evidenceId ?? run.id, kind: 'inconclusive', reason: 'decisive evidence is unavailable for this run' },
          'evidence unavailable: no decisive evidence was supplied',
          [])
         }

      const evidenceId = evidence.id
      const providedVerdict = config.verdicts.get(evidenceId) ?? {
        evidenceId,
        kind: 'inconclusive' as const,
        reason: 'no verdict recorded for evidence'
         }

      const check = checkDecisivePass(run, evidence, providedVerdict, approvedVerifierIds)

          // Case B: decisive pass. Authorized only when a well-formed control-plane
          // attestation is present; otherwise fail closed to needs-attention.
      if (check.ok) {
        if (attestation === undefined) {
          return deny(
            'needs-attention',
            {
              evidenceId,
              kind: 'inconclusive',
              reason: 'decisive pass requires a control-plane attestation, which was not supplied'
               },
            'publication denied: decisive pass present but no control-plane attestation supplied',
            [evidenceId])
           }
        const decision: PublicationDecision = {
          runId: run.id,
          authorized: true,
          policyVersion,
          decisiveEvidenceIds: [evidenceId],
          issuer: input.issuer,
          attestation,
          decidedAt: now(),
          reason: 'decisive pass on independent trusted-verifier evidence'
            }
        const published = transition(run, 'published')
        return { kind: 'authorized', decision, run: published }
         }

          // Case C: decisive check failed. A genuine FAIL from a trusted, independent,
          // approved verifier that actually ran is a terminal refusal; every other
          // failure (unrun, unavailable, untrusted, non-independent, unbound, or an
          // inconclusive verdict) is surfaced to the operator Inbox as
          // needs-attention / inconclusive. Neither branch ever authorizes.
      const reason = check.reason
      const isGenuineFail = reason === 'verdict is not pass' && providedVerdict.kind === 'fail'
      const kind: VerdictKind = isGenuineFail ? 'fail' : 'inconclusive'
      const nextState: Extract<Run['state'], 'needs-attention' | 'refused'> = isGenuineFail ? 'refused' : 'needs-attention'
      return deny(
        nextState,
        { evidenceId, kind, reason },
        `publication rejected: ${reason}`,
        isGenuineFail ? [] : [evidenceId])
       }
    }
}
