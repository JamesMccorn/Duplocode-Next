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
import type { AttestationFailure, AttestationVerifier, SignedAttestation } from '@duplocode/attestation'
import type { ApprovalRepository, EvidenceRepository, RunRepository, VerdictRepository } from './ports.js'
import { IllegalTransitionError, assertLegalTransition } from './transitions.js'

/** Fixed clock. The service never reads wall time by default, keeping runs reproducible. */
const DETERMINISTIC_NOW = (): IsoTimestamp => '1970-01-01T00:00:00.000Z'

/**
 * Auditable, human-readable reason for each closed attestation refusal. These map
 * one-to-one onto the @duplocode/attestation failure taxonomy so an operator can
 * tell *why* a signature would not admit a publication.
 */
const ATTESTATION_FAILURE_REASON: Record<AttestationFailure, string> = {
  unsigned: 'publication denied: attestation is unsigned',
 'invalid-signature': 'publication denied: attestation signature did not verify',
 'unknown-scheme': 'publication denied: attestation signature scheme is unknown',
 'untrusted-issuer': 'publication denied: attestation issuer is not trusted',
 'payload-mismatch': 'publication denied: attestation does not bind this decision'
}

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
  /**
   * The injected @duplocode/attestation verifier boundary. A structurally
   * well-formed attestation *reference* must never authorize on its own: the run's
   * binding (runId, policyVersion, decisiveEvidenceIds, issuer) must additionally be
   * covered by a signature that verifies under a trusted, controlled issuer. This is
   * the mechanism that lifts "a reference was supplied" to "a trusted signature
   * vouches for the binding".
   */
  readonly verifier: AttestationVerifier
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
   * Reference to the separately signed control-plane attestation recorded on the
   * decision. A well-formed reference is necessary but NEVER sufficient: it is
   * recorded for provenance, but publication is authorized only when `signed`
   * (below) verifies.
   */
  readonly attestation: ArtifactReference
  readonly issuer: string
  /**
   * The signed attestation the control plane supplies. It must be signed over a
   * canonical payload that binds this run, the policy version, this decisive
   * evidence, and the issuer, and must verify under a trusted, controlled issuer via
   * the injected verifier. Omission, an unsigned attestation, an untrusted issuer, a
   * forged signature, or a payload mismatch all fail closed — a structurally valid
   * attestation reference alone can never authorize.
   */
  readonly signed: SignedAttestation
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
          []
        )
      }

      const evidenceId = evidence.id
      const providedVerdict = config.verdicts.get(evidenceId) ?? {
        evidenceId,
        kind: 'inconclusive' as const,
        reason: 'no verdict recorded for evidence'
      }

      const check = checkDecisivePass(run, evidence, providedVerdict, approvedVerifierIds)

      // Case B: decisive pass. A pass is necessary but NOT sufficient. The binding
      // is authorized only on a validly signed, trusted attestation; every other
      // outcome — no verifier injected, no signed attestation supplied, unsigned,
      // unknown scheme, untrusted issuer, forged signature, or payload mismatch —
      // fails closed to needs-attention. A structurally valid reference alone never
      // authorizes.
      if (check.ok) {
        if (attestation === undefined) {
          return deny(
            'needs-attention',
            {
              evidenceId,
              kind: 'inconclusive',
              reason: 'decisive pass requires a control-plane attestation, which was not supplied'
            },
            'publication denied: decisive pass present but no control-plane attestation reference supplied',
            [evidenceId]
          )
        }

        // No boundary to check the signature against: fail closed.
        if (config.verifier === undefined) {
          return deny(
            'needs-attention',
            {
              evidenceId,
              kind: 'inconclusive',
              reason: 'decisive pass requires a signed attestation, but no attestation verifier is injected'
            },
            'publication denied: decisive pass present but no attestation verifier was configured',
            [evidenceId]
          )
        }

        // No signed attestation to verify: fail closed.
        const signed = input.signed
        if (signed === undefined) {
          return deny(
            'needs-attention',
            {
              evidenceId,
              kind: 'inconclusive',
              reason: 'decisive pass requires a signed control-plane attestation, which was not supplied'
            },
            'publication denied: decisive pass present but no signed attestation supplied',
            [evidenceId]
          )
        }

        // The consumer asserts the exact binding the signed attestation must cover:
        // this run, this policy version, this decisive evidence, and the claimed
        // issuer. The verifier checks the signature AND that the authenticated
        // issuer is trusted — trust comes from the signature, never self-claim.
        const expected = {
          runId: run.id,
          policyVersion,
          decisiveEvidenceIds: [evidenceId],
          issuer: input.issuer
        }
        const verdict = config.verifier.verify(expected, signed)
        if (!verdict.ok) {
          return deny(
            'needs-attention',
            {
              evidenceId,
              kind: 'inconclusive',
              reason: ATTESTATION_FAILURE_REASON[verdict.reason]
            },
            ATTESTATION_FAILURE_REASON[verdict.reason],
            [evidenceId]
          )
        }

        const decision: PublicationDecision = {
          runId: run.id,
          authorized: true,
          policyVersion,
          decisiveEvidenceIds: [evidenceId],
          // Record the *authenticated* issuer returned by the verifier, not the
          // self-claimed one, as the authority of record.
          issuer: verdict.issuer,
          attestation,
          decidedAt: now(),
          reason: 'decisive pass on independent trusted-verifier evidence, admitted on a trusted signed attestation'
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
        isGenuineFail ? [] : [evidenceId]
      )
    }
  }
}
