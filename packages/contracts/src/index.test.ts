import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDecisivePass, type Evidence, type Run, type Verdict } from './index.js'

const digest = 'sha256:test'
const run: Run = {
  id: 'run-1', proposalId: 'proposal-1', projectId: 'project-1', issueRef: 'issue-1', repositoryCommit: 'abc', compositionDigest: digest, state: 'verifying', admittedAt: '2026-01-01T00:00:00Z',
  composition: { dshRevision: 'pin', profileId: 'worker', profileDigest: digest, pluginDigests: {}, workerImageDigest: digest, modelRoute: 'model', policyVersion: 'policy-1', verificationSpecDigest: digest },
}
const evidence: Evidence = { id: 'evidence-1', runId: run.id, verifierId: 'verify-node', verifierTrustClass: 'trusted-verifier', verifierPlaneId: 'clean-room-1', verifierCompositionDigest: 'sha256:verifier', candidateDigest: digest, verificationSpecDigest: digest, ran: true, artifactReferences: [], receiptIds: [], observedAt: '2026-01-01T00:00:00Z' }
const verdict: Verdict = { evidenceId: evidence.id, kind: 'pass', reason: 'independent test passed' }

test('only bound, approved, independently-produced evidence can be decisive', () => {
  assert.deepEqual(checkDecisivePass(run, evidence, verdict, new Set(['verify-node'])), { ok: true })
  assert.equal(checkDecisivePass(run, evidence, { ...verdict, evidenceId: 'other' }, new Set(['verify-node'])).ok, false)
  assert.equal(checkDecisivePass(run, { ...evidence, ran: false }, verdict, new Set(['verify-node'])).ok, false)
  assert.equal(checkDecisivePass(run, evidence, verdict, new Set()).ok, false)
  assert.equal(checkDecisivePass(run, { ...evidence, verifierCompositionDigest: digest }, verdict, new Set(['verify-node'])).ok, false)
})
