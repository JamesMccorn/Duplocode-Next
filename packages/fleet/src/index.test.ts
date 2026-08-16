import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FleetSnapshotService,
  FakeFleetSource,
  grantCapacity,
  RefusedCapacityError,
  InsufficientCapacityError,
  type FleetEndpoint,
} from './index.js'

const endpoint = (): FleetEndpoint => ({
  id: 'ep-1',
  model: 'a100',
  residency: 'us-east',
  slots: [
    { id: 's0', free: true },
    { id: 's1', free: false },
  ],
})

test('a recent ok observation is fresh and grants on a matching free slot', async () => {
  let clock = 1_000
  const now = () => clock
  const source = new FakeFleetSource({ kind: 'ok', observedAt: 1_000, endpoints: [endpoint()] })
  const svc = new FleetSnapshotService({ source, now, staleAfterMs: 100 })

  const snap = await svc.refresh()
  assert.equal(snap.state, 'fresh')

  const grant = svc.grantCapacity({ runId: 'run-1', model: 'a100', residency: 'us-east' })
  assert.deepEqual(grant, {
    runId: 'run-1',
    endpointId: 'ep-1',
    slotId: 's0',
    model: 'a100',
    residency: 'us-east',
   })
})

test('a snapshot older than the threshold is stale and refuses capacity', async () => {
  let clock = 1_000
  const now = () => clock
  const source = new FakeFleetSource({ kind: 'ok', observedAt: 1_000, endpoints: [endpoint()] })
  const svc = new FleetSnapshotService({ source, now, staleAfterMs: 100 })

  clock = 1_000 + 101 // aged past the threshold
  const snap = await svc.refresh()
  assert.equal(snap.state, 'stale')

  assert.throws(() => svc.grantCapacity({ runId: 'run-2' }), RefusedCapacityError)
  assert.throws(() => grantCapacity(snap, { runId: 'run-2' }), (err: unknown) => {
    assert.ok(err instanceof RefusedCapacityError)
    assert.equal(err.state, 'stale')
    return true
   })
})

test('an unavailable observation refuses capacity', async () => {
  const source = new FakeFleetSource({ kind: 'unavailable', reason: 'backend down' })
  const svc = new FleetSnapshotService({ source, now: () => 0 })
  const snap = await svc.refresh()
  assert.equal(snap.state, 'unavailable')
  assert.deepEqual(snap.endpoints, [])
  assert.throws(() => svc.grantCapacity({ runId: 'run-3' }), RefusedCapacityError)
})

test('a throwing source is coerced to unavailable', async () => {
  const source = new FakeFleetSource()
  source.set({ kind: 'unavailable', reason: 'x' })
  const throwing = {
    observe() {
      return Promise.reject(new Error('boom'))
     },
   }
  const svc = new FleetSnapshotService({ source: throwing, now: () => 0 })
  const snap = await svc.refresh()
  assert.equal(snap.state, 'unavailable')
})

test('capacity matching by model and residency; insufficient when none match', async () => {
  const source = new FakeFleetSource({
    kind: 'ok',
    observedAt: 0,
    endpoints: [
      { id: 'ep-a', model: 'a100', residency: 'us-east', slots: [{ id: 's0', free: true }] },
      { id: 'ep-m', model: 'h100', residency: 'eu-west', slots: [{ id: 'm0', free: true }] },
     ],
  })
  const svc = new FleetSnapshotService({ source, now: () => 1, staleAfterMs: 100 })
  await svc.refresh()

  assert.equal(svc.grantCapacity({ runId: 'r', model: 'h100' }).endpointId, 'ep-m')
  assert.throws(
    () => svc.grantCapacity({ runId: 'r', model: 'a100', residency: 'eu-central' }),
    InsufficientCapacityError,
   )
})

test('current is undefined before the first refresh and refuses capacity', async () => {
  const svc = new FleetSnapshotService({ source: new FakeFleetSource(), now: () => 0 })
  assert.equal(svc.current(), undefined)
  assert.throws(() => svc.grantCapacity({ runId: 'r' }), RefusedCapacityError)
})

test('occupied slots are skipped in favor of a free slot', async () => {
  const source = new FakeFleetSource({
    kind: 'ok',
    observedAt: 0,
    endpoints: [{ id: 'ep-full', model: 'x', residency: 'r', slots: [{ id: 's0', free: false }, { id: 's1', free: true }] }],
   })
  const svc = new FleetSnapshotService({ source, now: () => 0 })
  await svc.refresh()
  assert.equal(svc.grantCapacity({ runId: 'r', model: 'x' }).slotId, 's1')
})
