import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateLease,
  isAvailable,
  LeaseStore,
  parseBoundary,
  type LeaseStatus
} from './index.js'

const FUTURE = '2030-01-01T00:00:00Z'
const NOW = '2026-01-01T00:00:00Z'

test('acquire mints a bounded, attributed lease', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  const lease = s.acquire({
     kind: 'worker',
     issuer: 'control-plane',
     subject: 'worker-1',
     limits: { cpu: 2, memoryMb: 4096 },
     expiresAt: FUTURE
   })
  assert.equal(lease.id, 'lease-1')
  assert.equal(lease.kind, 'worker')
  assert.equal(lease.issuer, 'control-plane')
  assert.equal(lease.subject, 'worker-1')
  assert.deepEqual(lease.limits, { cpu: 2, memoryMb: 4096 })
  assert.equal(lease.expiresAt, FUTURE)
  assert.equal(lease.revoked, false)
  assert.equal(lease.expiresAtMillis, parseBoundary(FUTURE))
})

test('valid lookup within the boundary surfaces valid', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  const lease = s.acquire({
     kind: 'model-route',
     issuer: 'ctrl',
     subject: 'route-a',
     limits: { qps: 5 },
     expiresAt: FUTURE
   })
  const status: LeaseStatus = s.lookup(lease.id, NOW)
  assert.deepEqual(status, { status: 'valid', lease: { ...s.get(lease.id) } })
  assert.equal(isAvailable(status), true)
})

test('limits are required and cannot be empty', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  assert.throws(
    () => s.acquire({ kind: 'event-ingest', issuer: 'c', subject: 's', limits: {}, expiresAt: FUTURE }),
    /limits are required/
  )
})

test('issuer and subject are required and non-empty', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  assert.throws(
    () => s.acquire({ kind: 'worker', issuer: '  ', subject: 's', limits: { x: 1 }, expiresAt: FUTURE }),
    /issuer is required/
  )
  assert.throws(
    () => s.acquire({ kind: 'worker', issuer: 'c', subject: '', limits: { x: 1 }, expiresAt: FUTURE }),
    /subject is required/
  )
})

test('unknown lease kind is rejected', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  assert.throws(
    () => s.acquire({ kind: 'credential' as never, issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE }),
    /unknown lease kind/
  )
})

test('malformed or empty expiry boundary is rejected', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  assert.throws(() => s.acquire({ kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: '' }), /non-empty string/)
  assert.throws(() => s.acquire({ kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: 'not-a-time' }), /unrecognized time boundary/)
})

test('explicit capacity is enforced as a bound', () => {
  const s = new LeaseStore({ maxLeases: 2 })
  s.acquire({ id: 'a', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE })
  s.acquire({ id: 'b', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE })
  assert.throws(
    () => s.acquire({ id: 'c', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE }),
    /at capacity/
  )
})

test('non-positive capacity is rejected at construction', () => {
  assert.throws(() => new LeaseStore({ maxLeases: 0 }), /positive integer/)
  assert.throws(() => new LeaseStore({ maxLeases: 1.5 }), /positive integer/)
})

test('duplicate id is rejected', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  s.acquire({ id: 'dup', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE })
  assert.throws(
    () => s.acquire({ id: 'dup', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE }),
    /already exists/
  )
})

test('expired lease surfaces as unavailable, not valid', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  const lease = s.acquire({ id: 'exp', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: NOW })
  // Before the boundary: valid.
  assert.equal(isAvailable(s.lookup('exp', '2025-12-31T00:00:00Z')), true)
  // Exactly at the boundary: expired (fail closed).
  assert.deepEqual(s.lookup('exp', NOW), { status: 'unavailable', reason: 'expired', id: 'exp' })
  // After the boundary: expired.
  assert.deepEqual(s.lookup('exp', FUTURE), { status: 'unavailable', reason: 'expired', id: 'exp' })
})

test('revoked lease surfaces as unavailable and revoke is idempotent', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  const lease = s.acquire({ id: 'r', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE })
  assert.equal(s.lookup('r', NOW).status, 'valid')
  assert.equal(s.revoke('r'), true)
  // Revocation is permanent; second call is a no-op.
  assert.equal(s.revoke('r'), false)
  assert.equal(s.revoke('nope'), false)
  assert.deepEqual(s.lookup('r', NOW), { status: 'unavailable', reason: 'revoked', id: 'r' })
  // Revocation outranks time: a far-future expiry is still unavailable.
  assert.deepEqual(s.lookup('r', '2099-01-01T00:00:00Z'), { status: 'unavailable', reason: 'revoked', id: 'r' })
})

test('unknown lease surfaces as not-found', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  assert.deepEqual(s.lookup('ghost', NOW), { status: 'unavailable', reason: 'not-found', id: 'ghost' })
})

test('an unparseable asOf boundary surfaces as unavailable (no wall-clock fallback)', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  const lease = s.acquire({ id: 't', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE })
  assert.deepEqual(s.lookup('t', 'not-a-time'), { status: 'unavailable', reason: 'invalid-boundary', id: 't' })
  assert.equal(s.get('t')?.revoked, false)
})

test('validity is judged by supplied boundary, never by wall-clock time', async () => {
  const s = new LeaseStore({ maxLeases: 4 })
  const lease = s.acquire({
     kind: 'model-route',
     issuer: 'c',
     subject: 'route',
     limits: { qps: 1 },
     expiresAt: '2030-06-01T00:00:00Z'
   })
  // Wait on real time; the lease must NOT auto-expire or change decision.
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(isAvailable(s.lookup(lease.id, '2026-01-01T00:00:00Z')), true)
  assert.equal(s.get(lease.id)?.revoked, false)
})

test('minted limits are frozen and cannot be widened', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  const lease = s.acquire({ kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE })
  assert.ok(Object.isFrozen(lease.limits))
  // Even a cast cannot mutate the returned frozen snapshot.
  assert.throws(() => {
    ;(lease.limits as Record<string, number>).x = 999
   })
})

test('get retrieves a record but does not decide validity', () => {
  const s = new LeaseStore({ maxLeases: 4 })
  s.acquire({ id: 'g', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: NOW })
  assert.equal(s.has('g'), true)
  assert.equal(s.get('g')?.revoked, false)
  assert.equal(s.get('missing')?.revoked, undefined)
  assert.deepEqual(s.ids(), ['g'])
  // The record still exists but reports unavailable via lookup.
  assert.equal(s.lookup('g', '2027-01-01T00:00:00Z').status, 'unavailable')
})

test('revoked records are retained and keep the capacity bound meaningful', () => {
  const s = new LeaseStore({ maxLeases: 1 })
  s.acquire({ id: 'x', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE })
  assert.equal(s.revoke('x'), true)
  // A revoked slot still occupies the bounded capacity.
  assert.throws(
    () => s.acquire({ id: 'y', kind: 'worker', issuer: 'c', subject: 's', limits: { x: 1 }, expiresAt: FUTURE }),
    /at capacity/
  )
  assert.equal(s.size, 1)
})

test('evaluateLease is a pure fail-closed comparator', () => {
  const record = {
     id: 'e',
     kind: 'event-ingest' as const,
     issuer: 'ctrl',
     subject: 'ingest',
     limits: Object.freeze({ ratePerSec: 10 }) as Readonly<Record<string, number>>,
     expiresAt: '2030-01-01T00:00:00Z',
     expiresAtMillis: parseBoundary('2030-01-01T00:00:00Z'),
     revoked: false
   }
  assert.equal(isAvailable(evaluateLease(record, '2026-01-01T00:00:00Z')), true)
  assert.deepEqual(evaluateLease({ ...record, revoked: true }, NOW), { status: 'unavailable', reason: 'revoked', id: 'e' })
  assert.deepEqual(evaluateLease(record, '2031-01-01T00:00:00Z'), { status: 'unavailable', reason: 'expired', id: 'e' })
  assert.deepEqual(evaluateLease(record, ''), { status: 'unavailable', reason: 'invalid-boundary', id: 'e' })
})
