import assert from 'node:assert/strict'
import test from 'node:test'
import { ProxmoxHttpAdapter, type ProxmoxRequest, type ProxmoxResponse, type ProxmoxTransport, type ScopedTokenSupplier } from './http-adapter.js'
import type { WorkerProfile, WorkerReceipt } from './index.js'

interface RecordedCall { readonly request: ProxmoxRequest; readonly token: string }

/**
 * Fake transport: records each request it is asked to send and returns a canned
 * response. It deliberately does NOT surface the token in any recorded response so
 * the tests can assert that the token never appears in a request's serialized shape.
 */
class FakeTransport implements ProxmoxTransport {
  readonly calls: RecordedCall[] = []
   #failStatus: number | null = null
  constructor(private readonly tokenSupplier: ScopedTokenSupplier) {}

   failWith(status: number): void { this.#failStatus = status }

  async send<T>(request: ProxmoxRequest, scopedToken: string): Promise<ProxmoxResponse<T>> {
    this.calls.push({ request, token: scopedToken })
    // Security invariant: the scoped token must never be embedded in the request.
    assert.equal(JSON.stringify(request).includes(scopedToken), false, 'token leaked into request')
    if (this.#failStatus !== null) return { ok: false, status: this.#failStatus, data: {} as unknown as T }
    return { ok: true, status: 200, data: { ok: true } as unknown as T }
   }
}

const profile: WorkerProfile = {
  id: 'duplocode-worker-base-v1',
  imageDigest: 'sha256:abcdef0123456789',
  compositionDigest: 'sha256:9988776655',
  pool: 'builder-arms',
  node: 'pve2',
}

function tokenFor(scopeToken: string): ScopedTokenSupplier {
  return async (scope) => {
    assert.equal(typeof scope.runId, 'string')
    assert.equal(scope.profile.id, 'duplocode-worker-base-v1')
    return scopeToken
   }
}

const TERMINAL = (state: WorkerReceipt['state'], runId: string): WorkerReceipt =>
   ({ runId, state, observedAt: 'now', detail: state })

test('version request is read-only and resolves a scoped token', async () => {
  const token = 'token-version'
  const transport = new FakeTransport(tokenFor(token))
  const adapter = new ProxmoxHttpAdapter({ transport, tokenSupplier: tokenFor(token) })

  const response = await adapter.version(profile)
  assert.deepEqual(transport.calls, [
    { request: { method: 'GET', path: '/api2/json/nodes/pve2/version' }, token },
   ])
  assert.equal(response.ok, true)
})

test('clone and start request construction shape the destructive calls', async () => {
  const transport = new FakeTransport(tokenFor('t'))
  const adapter = new ProxmoxHttpAdapter({ transport, tokenSupplier: tokenFor('t'), apiRoot: '/api2/json' })

  assert.deepEqual(adapter.cloneRequest('run-1', profile), {
    method: 'POST',
    path: '/nodes/pve2/openvz/duplocode-worker-base-v1/clone',
    body: { target: 'worker-run-1', full: false, name: 'abcdef' },
   })
  assert.deepEqual(adapter.startRequest('run-1', profile), {
    method: 'POST',
    path: '/nodes/pve2/openvz/run-1/start',
    body: { start: '1' },
   })
  assert.equal(transport.calls.length, 0)
})

test('destroy construction is gated on a caller-provided terminal receipt', async () => {
  const adapter = new ProxmoxHttpAdapter({
    transport: new FakeTransport(tokenFor('t')),
    tokenSupplier: tokenFor('t'),
   })

  assert.throws(() => adapter.destroyRequest(profile, TERMINAL('ready', 'run-1')), /terminal receipt state/)
  assert.throws(() => adapter.destroyRequest(profile, TERMINAL('requested', 'run-1')), /terminal receipt state/)

  const request = adapter.destroyRequest(profile, TERMINAL('lost', 'run-1'))
  assert.deepEqual(request, {
    method: 'DELETE',
    path: '/nodes/pve2/openvz/run-1/stop',
    body: { stop: '1' },
   })
})

test('destroy only dispatches with a terminal receipt and matching run', async () => {
  const token = 'token-destroy'
  const transport = new FakeTransport(tokenFor(token))
  const adapter = new ProxmoxHttpAdapter({ transport, tokenSupplier: tokenFor(token) })

  await assert.rejects(adapter.destroy('run-1', profile, TERMINAL('ready', 'run-1')), /terminal receipt state/)
  await assert.rejects(adapter.destroy('run-2', profile, TERMINAL('lost', 'run-1')), /run mismatch/)

  const response = await adapter.destroy('run-1', profile, TERMINAL('lost', 'run-1'))
  assert.equal(response.ok, true)
  assert.deepEqual(transport.calls[0]?.request, {
    method: 'DELETE',
    path: '/api2/json/nodes/pve2/openvz/run-1/stop',
    body: { stop: '1' },
   })
  assert.equal(transport.calls[0]?.token, token)
})

test('a non-ok transport response surfaces as an error', async () => {
  const token = 'token-400'
  const transport = new FakeTransport(tokenFor(token))
  transport.failWith(400)
  const adapter = new ProxmoxHttpAdapter({ transport, tokenSupplier: tokenFor(token) })

  await assert.rejects(adapter.clone('run-1', profile), /POST .*\/clone failed with 400/)
})
