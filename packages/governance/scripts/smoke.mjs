/**
 * End-to-end smoke exercise of the governance RunService against in-memory ports.
 * Run after `npm run build` (the `smoke` npm script builds first): `npm run smoke`.
 *
 * It deliberately demonstrates BOTH the authorize path and a fail-closed path so
 * the script asserts the package's central invariant: a structurally valid
 * attestation *reference* can never authorize on its own — publication requires a
 * signature that verifies under a trusted, controlled issuer for the exact binding.
 */
import assert from 'node:assert/strict'
import {
  createAttestationSigner,
  createAttestationVerifier,
  createHmacSha256Scheme
} from '@duplocode/attestation'
import {
  createMemoryApprovalRepository,
  createMemoryEvidenceRepository,
  createMemoryRunRepository,
  createMemoryVerdictRepository,
  createRunService
} from '../dist/index.js'

const sha = (b) => `sha256:${b.repeat(64).slice(0, 64)}`

// The control-plane signer/verifier boundary that governance delegates to.
const scheme = createHmacSha256Scheme()
const CONTROL_PLANE_ISSUER = 'cta'
const CONTROL_PLANE_KEY = 'smoke-cp-key'
const signer = createAttestationSigner(scheme, CONTROL_PLANE_KEY)
const verifier = createAttestationVerifier({
  trustedIssuers: new Map([[CONTROL_PLANE_ISSUER, CONTROL_PLANE_KEY]]),
  schemes: new Map([[scheme.id, scheme]])
})

const reference = { digest: sha('0'), mediaType: 'application/duplocode-attestation+json', uri: 'attestations/' }

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
  approvals: createMemoryApprovalRepository(['verifier-trusted']),
  verifier
})

const run = service.admit(proposal)
service.applyTransition(run.id, 'leased')
service.applyTransition(run.id, 'dispatching')
service.applyTransition(run.id, 'running')
service.applyTransition(run.id, 'verifying')

// Fail-closed path first: unavailable evidence must not authorize.
// A structurally valid attestation reference alone is NOT enough to authorize.
const unrun = service.attemptPublication({
  runId: run.id,
  evidenceId: 'ev-absent',
  attestation: reference,
  issuer: CONTROL_PLANE_ISSUER
})
assert.equal(unrun.kind, 'needs-attention')
assert.equal(unrun.decision.authorized, false)

// Recover and provide decisive, trusted, independent evidence.
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

// A well-formed reference WITHOUT a verifying signature must NOT authorize...
const referenceOnly = service.attemptPublication({
  runId: run.id,
  evidenceId: evidence.id,
  attestation: reference,
  issuer: CONTROL_PLANE_ISSUER,
  policyVersion: 'policy-1'
})
assert.equal(referenceOnly.kind, 'needs-attention')
assert.equal(referenceOnly.decision.authorized, false)

// ...but a trusted, validly signed attestation over the exact binding does.
// (Re-record the pass verdict: the reference-only attempt above surfaced an
// inconclusive verdict and moved the run to needs-attention, which a recovery
// through verifying then a signed attestation legitimately clears.)
service.applyTransition(run.id, 'verifying')
service.recordVerdict({ evidenceId: evidence.id, kind: 'pass', reason: 'checks pass' })
const signed = signer.sign({
  runId: run.id,
  policyVersion: 'policy-1',
  decisiveEvidenceIds: [evidence.id],
  issuer: CONTROL_PLANE_ISSUER
})

const ok = service.attemptPublication({
  runId: run.id,
  evidenceId: evidence.id,
  attestation: reference,
  signed,
  issuer: CONTROL_PLANE_ISSUER,
  policyVersion: 'policy-1'
})
assert.equal(ok.kind, 'authorized')
assert.equal(ok.run.state, 'published')
// The decision records the *authenticated* issuer, not a self-claimed one.
assert.equal(ok.decision.issuer, CONTROL_PLANE_ISSUER)

console.log('governance smoke: authorized publication =', ok.decision.authorized,
    '| fail-closed on unavailable evidence =', unrun.kind,
    '| fail-closed on reference-only =', referenceOnly.kind)
console.log('PASS')
