/**
 * End-to-end smoke exercise of the governance RunService against in-memory ports.
 * Run after `npm run build` (the `smoke` npm script builds first): `npm run smoke`.
 *
 * It deliberately demonstrates BOTH the authorize path and a fail-closed path so
 * the script asserts the package's central invariant: publication only ever
 * happens on a decisive, trusted, independent pass with a supplied attestation.
 */
import assert from 'node:assert/strict'
import {
  createMemoryApprovalRepository,
  createMemoryEvidenceRepository,
  createMemoryRunRepository,
  createMemoryVerdictRepository,
  createRunService
} from '../dist/index.js'

const sha = (b) => `sha256:${b.repeat(64).slice(0, 64)}`

const composition = {
  dshRevision: 'dsh@abc',
  profileId: 'duplocode-control',
  profileDigest: sha('a'),
  pluginDigests: { 'plugin-a': sha('b') },
  workerImageDigest: sha('c'),
  modelRoute: 'ollama:local/gpt',
  policyVersion: 'policy-1',
  verificationSpecDigest: sha('d')
}
const proposal = {
  id: 'wp-smoke',
  projectId: 'proj',
  issueRef: 'ISSUE-1',
  requestedBy: 'operator',
  createdAt: '2020-01-01T00:00:00.000Z',
  scope: 'smoke',
  repositoryCommit: 'deadbeef',
  requestedComposition: composition
}

const service = createRunService({
  runs: createMemoryRunRepository(),
  evidence: createMemoryEvidenceRepository(),
  verdicts: createMemoryVerdictRepository(),
  approvals: createMemoryApprovalRepository(['verifier-trusted'])
})

const run = service.admit(proposal)
service.applyTransition(run.id, 'leased')
service.applyTransition(run.id, 'dispatching')
service.applyTransition(run.id, 'running')
service.applyTransition(run.id, 'verifying')

// Fail-closed path first: unavailable evidence must not authorize.
const unrun = service.attemptPublication({
  runId: run.id,
  evidenceId: 'ev-absent',
  attestation: { digest: sha('0'), mediaType: 'application/duplocode-attestation+json', uri: 'attestations/' },
  issuer: 'ctl'
})
assert.equal(unrun.kind, 'needs-attention')
assert.equal(unrun.decision.authorized, false)

// Recover and provide decisive, trusted, independent evidence plus an attestation.
service.applyTransition(run.id, 'verifying')
const evidence = {
  id: 'ev-smoke',
  runId: run.id,
  verifierId: 'verifier-trusted',
  verifierTrustClass: 'trusted-verifier',
  verifierPlaneId: 'verifier-plane-1',
  verifierCompositionDigest: sha('e'),
  candidateDigest: sha('f'),
  verificationSpecDigest: composition.verificationSpecDigest,
  ran: true,
  artifactReferences: [],
  receiptIds: [],
  observedAt: '2020-01-01T00:00:00.000Z'
}
service.recordEvidence(evidence)
service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'checks pass' })

const ok = service.attemptPublication({
  runId: run.id,
  evidenceId: evidence.id,
  attestation: { digest: sha('0'), mediaType: 'application/duplocode-attestation+json', uri: 'attestations/' },
  issuer: 'ctl'
})
assert.equal(ok.kind, 'authorized')
assert.equal(ok.run.state, 'published')

console.log('governance smoke: authorized publication =', ok.decision.authorized,
   '| fail-closed on unavailable evidence =', unrun.kind)
console.log('PASS')
