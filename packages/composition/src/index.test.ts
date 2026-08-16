import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalJson, digestComposition, digestRunComposition } from './index.js'

test('canonical JSON ignores object insertion order', () => {
  const first = { dshRevision: 'abc', plugins: { alpha: '1', beta: '2' } }
  const second = { plugins: { beta: '2', alpha: '1' }, dshRevision: 'abc' }

  assert.equal(canonicalJson(first), canonicalJson(second))
  assert.equal(digestComposition(first), digestComposition(second))
})

test('canonical JSON rejects non-finite numbers', () => {
  assert.throws(() => canonicalJson({ budget: Number.NaN }), /non-finite/)
})

test('run composition digest rejects unknown admission inputs', () => {
  const manifest = { schemaVersion: 1 as const, repositoryCommit: 'abc123', executionComposition: { dshRevision: 'pin' } }
  assert.match(digestRunComposition(manifest), /^sha256:/)
  assert.throws(() => digestRunComposition({ ...manifest, ambient: 'not-pinned' }), /exactly/)
})
