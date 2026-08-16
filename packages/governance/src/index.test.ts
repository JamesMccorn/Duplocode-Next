import assert from 'node:assert/strict'
import test from 'node:test'

import type { ArtifactReference, Evidence, ExecutionComposition, Run, Sha256Digest, WorkProposal } from '@duplocode/contracts'
import { digestRunComposition, type CanonicalJson } from '@duplocode/composition'
import {
  type RunService,
  createMemoryApprovalRepository,
  createMemoryEvidenceRepository,
  createMemoryRunRepository,
  createMemoryVerdictRepository,
  createRunService,
  IllegalTransitionError
} from './index.js'

const FIXED_CLOCK = () => '2020-01-01T00:00:00.000Z'

const sha = (bytes: string): Sha256Digest => `sha256:${bytes.repeat(64).slice(0, 64)}`

function makeComposition(overrides: Partial<ExecutionComposition> = {}): ExecutionComposition {
  return {
    dshRevision: 'dsh@abc',
    profileId: 'duplocode-control',
    profileDigest: sha('a'),
    pluginDigests: { 'plugin-a': sha('b') },
    workerImageDigest: sha('c'),
    modelRoute: 'ollama:local/gpt',
    policyVersion: 'policy-1',
    verificationSpecDigest: sha('d'),
    ...overrides
  }
}

function makeProposal(overrides: Partial<WorkProposal> = {}): WorkProposal {
  return {
    id: 'wp-1',
    projectId: 'proj',
    issueRef: 'ISSUE-1',
    requestedBy: 'operator',
    createdAt: '2020-01-01T00:00:00.000Z',
    scope: 'implement feature',
    repositoryCommit: 'deadbeef',
    requestedComposition: makeComposition(),
    ...overrides
  }
}

function makeService(approved: readonly string[] = ['verifier-trusted']): RunService {
  return createRunService({
    runs: createMemoryRunRepository(),
    evidence: createMemoryEvidenceRepository(),
    verdicts: createMemoryVerdictRepository(),
    approvals: createMemoryApprovalRepository(approved),
    now: FIXED_CLOCK
  })
}

function closedDigest(proposal: WorkProposal): Sha256Digest {
  return digestRunComposition({
    schemaVersion: 1,
    repositoryCommit: proposal.repositoryCommit,
    executionComposition: proposal.requestedComposition as unknown as CanonicalJson
  })
}

function runToVerifying(service: RunService, run: Run): Run {
  service.applyTransition(run.id, 'leased')
  service.applyTransition(run.id, 'dispatching')
  service.applyTransition(run.id, 'running')
  return service.applyTransition(run.id, 'verifying')
}

function makeEvidence(run: Run, overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    runId: run.id,
    verifierId: 'verifier-trusted',
    verifierTrustClass: 'trusted-verifier',
    verifierPlaneId: 'verifier-plane-1',
    verifierCompositionDigest: sha('e'),
    candidateDigest: sha('f'),
    verificationSpecDigest: run.composition.verificationSpecDigest,
    ran: true,
    artifactReferences: [],
    receiptIds: [],
    observedAt: '2020-01-01T00:00:00.000Z',
    ...overrides
  }
}

function attestation(): ArtifactReference {
  return { digest: sha('0'), mediaType: 'application/duplocode-attestation+json', uri: 'attestations/run-wp-1/decision' }
}

function malformedAttestation(): ArtifactReference {
  return { digest: 'not-a-digest', mediaType: '', uri: '' } as unknown as ArtifactReference
}

test('admission produces a run in the admitted state with a closed composition digest', () => {
  const service = makeService()
  const proposal = makeProposal()
  const run = service.admit(proposal)

  assert.equal(run.state, 'admitted')
  assert.equal(run.id, 'run-wp-1')
  assert.equal(run.repositoryCommit, proposal.repositoryCommit)
  assert.equal(run.compositionDigest, closedDigest(proposal))
})

test('admission verifies an expected composition digest and fails closed on mismatch', () => {
  const service = makeService()
  const proposal = makeProposal()
  assert.doesNotThrow(() => service.admit(proposal, { expectedCompositionDigest: closedDigest(proposal) }))
  assert.throws(() => service.admit(makeProposal(), { expectedCompositionDigest: sha('z') }), /does not match expected/)
})

test('admission is idempotent for a single run identity and rejects duplicates', () => {
  const service = makeService()
  service.admit(makeProposal(), { runId: 'run-x' })
  assert.throws(() => service.admit(makeProposal(), { runId: 'run-x' }), /already been admitted/)
})

test('a different composition yields a different digest', () => {
  const a = makeService().admit(makeProposal({ requestedComposition: makeComposition({ policyVersion: 'policy-1' }) }))
  const b = makeService().admit(makeProposal({ id: 'wp-2', requestedComposition: makeComposition({ policyVersion: 'policy-2' }) }))
  assert.notEqual(a.compositionDigest, b.compositionDigest)
})

test('legal lifecycle transitions succeed', () => {
  const service = makeService()
  const run = service.admit(makeProposal())
  runToVerifying(service, run)
  assert.equal(service.getRun(run.id)!.state, 'verifying')
  service.applyTransition(run.id, 'refused')
  assert.equal(service.getRun(run.id)!.state, 'refused')
})

test('illegal and terminal transitions are rejected', () => {
  const service = makeService()
  const run = service.admit(makeProposal())
  assert.throws(() => service.applyTransition(run.id, 'published'), IllegalTransitionError)
  assert.throws(() => service.applyTransition(run.id, 'completed'), IllegalTransitionError)

  const toRefuse = runToVerifying(service, service.admit(makeProposal({ id: 'wp-2' })))
  service.applyTransition(toRefuse.id, 'refused')
  assert.throws(() => service.applyTransition(toRefuse.id, 'leased'), IllegalTransitionError)
})

test('unknown run ids raise', () => {
  const service = makeService()
  assert.throws(() => service.applyTransition('run-missing', 'leased'), /Unknown run/)
  assert.throws(() => service.attemptPublication({ runId: 'run-missing', attestation: attestation(), issuer: 'ctl' }), /Unknown run/)
})

test('happy path: decisive pass on independent trusted evidence authorizes publication', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  const evidence = makeEvidence(run)
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'all checks pass' })

  const outcome = service.attemptPublication({
    runId: run.id,
    evidenceId: evidence.id,
    attestation: attestation(),
    issuer: 'control-plane/attestation-service',
    policyVersion: 'policy-1'
  })

  assert.equal(outcome.kind, 'authorized')
  assert.equal(outcome.decision.authorized, true)
  assert.deepEqual(outcome.decision.decisiveEvidenceIds, [evidence.id])
  assert.equal(outcome.run.state, 'published')
  assert.equal(outcome.decision.attestation.uri, attestation().uri)
})

test('decisive pass without a well-formed control-plane attestation is refused, never authorized', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  const evidence = makeEvidence(run)
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'ok' })

  const outcome = service.attemptPublication({ runId: run.id, evidenceId: evidence.id, attestation: malformedAttestation(), issuer: 'ctl' })
  assert.equal(outcome.kind, 'needs-attention')
  assert.equal(outcome.decision.authorized, false)
  assert.equal(outcome.verdict.kind, 'inconclusive')
  assert.equal(service.getRun(run.id)!.state, 'needs-attention')
  assert.match(outcome.decision.reason, /attestation/)
})

test('unrun evidence is surfaced as needs-attention / inconclusive, never pass', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  const evidence = makeEvidence(run, { ran: false })
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'inconclusive', reason: 'did not run' })

  const outcome = service.attemptPublication({ runId: run.id, evidenceId: evidence.id, attestation: attestation(), issuer: 'ctl' })
  assert.equal(outcome.kind, 'needs-attention')
  assert.equal(outcome.decision.authorized, false)
  assert.equal(outcome.verdict.kind, 'inconclusive')
  assert.equal(service.getRun(run.id)!.state, 'needs-attention')
})

test('unavailable evidence is surfaced as needs-attention / inconclusive', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  const outcome = service.attemptPublication({ runId: run.id, attestation: attestation(), issuer: 'ctl' })
  assert.equal(outcome.kind, 'needs-attention')
  assert.equal(outcome.decision.authorized, false)
  assert.equal(outcome.verdict.kind, 'inconclusive')
  assert.match(outcome.decision.reason, /unavailable/)
})

test('a non-independent verifier (its composition matches the producer) fails closed to needs-attention', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  const evidence = makeEvidence(run, { verifierCompositionDigest: run.compositionDigest })
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'ok' })

  const outcome = service.attemptPublication({ runId: run.id, evidenceId: evidence.id, attestation: attestation(), issuer: 'ctl' })
  assert.equal(outcome.kind, 'needs-attention')
  assert.equal(outcome.decision.authorized, false)
  assert.equal(outcome.verdict.kind, 'inconclusive')
})

test('an untrusted verifier (not approved) fails closed and never authorizes', () => {
  const service = makeService(['verifier-trusted'])
  const run = runToVerifying(service, service.admit(makeProposal()))
  const evidence = makeEvidence(run, { verifierId: 'verifier-rogue' })
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'ok' })

  const outcome = service.attemptPublication({ runId: run.id, evidenceId: evidence.id, attestation: attestation(), issuer: 'ctl' })
  assert.equal(outcome.decision.authorized, false)
  assert.notEqual(outcome.kind, 'authorized')
})

test('a genuine fail verdict from a trusted independent verifier is a terminal refusal', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  const evidence = makeEvidence(run)
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'fail', reason: 'check 3 failed' })

  const outcome = service.attemptPublication({ runId: run.id, evidenceId: evidence.id, attestation: attestation(), issuer: 'ctl' })
  assert.equal(outcome.kind, 'refused')
  assert.equal(outcome.decision.authorized, false)
  assert.equal(outcome.verdict.kind, 'fail')
  assert.equal(service.getRun(run.id)!.state, 'refused')
})

test('evidence bound to another run cannot authorize this run', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  const foreign = service.admit(makeProposal({ id: 'wp-other' }))
  const evidence = makeEvidence(foreign)
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'ok' })

  const outcome = service.attemptPublication({ runId: run.id, evidenceId: evidence.id, attestation: attestation(), issuer: 'ctl' })
  assert.equal(outcome.decision.authorized, false)
  assert.match(outcome.decision.reason, /another run/)
})

test('publication is illegal from a non-verification pre-state', () => {
  const service = makeService()
  const run = service.admit(makeProposal())
  assert.throws(() => service.attemptPublication({ runId: run.id, attestation: attestation(), issuer: 'ctl' }), IllegalTransitionError)
})

test('a needs-attention run can recover through verifying and publish', () => {
  const service = makeService()
  const run = runToVerifying(service, service.admit(makeProposal()))
  service.applyTransition(run.id, 'needs-attention')
  const evidence = makeEvidence(run)
  service.recordEvidence(evidence)
  service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'recovered' })

  service.applyTransition(run.id, 'verifying')
  const outcome = service.attemptPublication({ runId: run.id, evidenceId: evidence.id, attestation: attestation(), issuer: 'ctl' })
  assert.equal(outcome.kind, 'authorized')
  assert.equal(outcome.run.state, 'published')
  assert.equal(service.getRun(run.id)!.state, 'published')
})

test('in-memory repositories are independent and deterministic', () => {
  const runsA = createMemoryRunRepository()
  const runsB = createMemoryRunRepository()
  const first = makeService().admit(makeProposal())
  runsA.put(first)
  assert.equal(runsA.list().length, 1)
  assert.equal(runsB.list().length, 0)
})
