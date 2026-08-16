import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalJson, digestComposition, digestRunComposition, sha256 } from './index.js'

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

// Fixed SHA-256 digest vectors. Expected values were derived once, independently of
// the implementation under test, with a standalone reimplementation of the canonical
// form (sorted object keys, compact JSON, numbers via JSON.stringify, UTF-8 encode).
// They are intentionally hard-coded so any change to canonicalization is caught here.

test('sha256 primitive matches known-answer vectors', () => {
  // NIST / RFC 6234 known answer for the empty UTF-8 input.
  assert.equal(sha256(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('fixed digest vectors for nested structures', () => {
  assert.equal(
    digestComposition({}),
    'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  )
  assert.equal(
    // shallow nesting with sorted keys and a nested array that keeps its own order
    digestComposition({ b: { z: [3, 2, 1], a: 'x' }, a: 1 }),
    'sha256:2fc5b21837b011739af83454e0e5644a1bd28719ae3f651cf7c08525e1f362bd',
  )
  assert.equal(
    // deep nesting mixing objects, arrays, booleans and null leaves
    digestComposition({ level1: { level2: { level3: ['leaf', { k: true }], done: null } } }),
    'sha256:20dbfe044378e7dedfc6cb09fe0142b82ff66c211a2c96a99293667f1021ec17',
  )
})

test('fixed digest vectors for Unicode (values and keys)', () => {
  assert.equal(
    // non-ASCII string values keep their UTF-8 bytes in the hash input
    digestComposition({ name: 'café', emoji: '🎉', text: '日本語文字' }),
    'sha256:330887486d0d529ff9c2ed174e258b288cb3faecf4852a4d569a9ca865fa4844',
  )
  assert.equal(
    // non-ASCII object keys are JSON-encoded and sorted by UTF-16 code unit order
    digestComposition({ 'café': 1, 'emoji-key': 2, 'naïve': 3 }),
    'sha256:de5c1929719b6f1e64905fa3efdbb9ee2f27d2644ae1bb8f3e25a5c5162ffae4',
  )
})

test('fixed digest vector for key-order permutation invariance', () => {
  const forward = { c: 3, a: 1, b: 2 }
  const backward = { b: 2, c: 3, a: 1 }
  // Object key order (including nested and empty-array) must not affect the digest.
  assert.equal(
    digestComposition({ outer: { z: 1, a: 2 }, beta: { b: 2, a: 1, m: [] }, a: 'first' }),
    'sha256:256a93d2279793a2eae8e2a2496705b2136a54b4811eda124b1a6c3d7098e389',
  )
  assert.equal(digestComposition(forward), digestComposition(backward))
  assert.equal(canonicalJson(forward), canonicalJson(backward))
  assert.equal(canonicalJson({ c: 3, a: 1, b: 2 }), '{"a":1,"b":2,"c":3}')
})

test('fixed digest vector for negative zero behavior', () => {
  // JSON.stringify serializes -0, 0 and 0.0 identically, so they are digest-equal; the
  // string "-0" is a distinct value and must not collide with numeric zero.
  assert.equal(digestComposition({ n: -0 }), digestComposition({ n: 0 }))
  assert.equal(digestComposition({ n: -0 }), 'sha256:f3013f933b9fb80ab6d995e7ad9da36f683837ba1d81e950c943d40111eac2f0')
  assert.notEqual(digestComposition({ n: -0 }), digestComposition({ n: '-0' }))
  assert.equal(
    digestComposition({ a: -0, b: 0, c: 0, d: '-0' }),
    'sha256:b77aff30beec8ab60709b6cb3646bdf4f2c6bd1ea1c1a22b4e085a06f6f4558d',
  )
})
