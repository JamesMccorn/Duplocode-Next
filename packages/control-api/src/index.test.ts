import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createControlServer, inertAdmissionHandler, type AdmissionHandler } from './index.js'

async function withServer(config: Parameters<typeof createControlServer>[0], fn: (url: string) => Promise<void> ) {
  const server = createControlServer(config)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

function admittingHandler(runId = 'run-42'): AdmissionHandler {
  return {
    admit: (body, context) => {
      assert.deepEqual(context, { source: 'http', path: '/work-proposals' })
      if (body && typeof body === 'object' && 'id' in body) {
        return { accepted: true, runId }
      }
      return { accepted: false, reason: 'proposal missing id' }
    }
  }
}

test('health endpoint exposes no governance authority', async () => {
  await withServer({}, async (url) => {
    const response = await fetch(`${url}/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
  })
})

test('POST /work-proposals returns 202 only when the handler admits', async () => {
  await withServer({ admission: admittingHandler('run-7') }, async (url) => {
    const response = await fetch(`${url}/work-proposals`, {
      method: 'POST',
      body: JSON.stringify({ id: 'wp-1', scope: 'x' }),
      headers: { 'content-type': 'application/json' }
    })
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), { accepted: true, runId: 'run-7' })
  })
})

test('malformed JSON body is rejected with 400 before admission', async () => {
  await withServer({ admission: admittingHandler() }, async (url) => {
    const response = await fetch(`${url}/work-proposals`, { method: 'POST', body: '{ not json' })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'malformed json' })
  })
})

test('a non-accepting handler yields no 202', async () => {
  await withServer({}, async (url) => {
    const response = await fetch(`${url}/work-proposals`, {
      method: 'POST',
      body: JSON.stringify({ id: 'wp-1' })
    })
    assert.notEqual(response.status, 202)
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { accepted: false, reason: 'no admission authority configured' })
  })
})

test('inert handler admits nothing even for valid proposals', async () => {
  await withServer({ admission: inertAdmissionHandler() }, async (url) => {
    const response = await fetch(`${url}/work-proposals`, {
      method: 'POST',
      body: JSON.stringify({ id: 'wp-1', scope: 'x' })
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).accepted, false)
  })
})

test('worker and publish surfaces are not exposed', async () => {
  await withServer({ admission: admittingHandler() }, async (url) => {
    for (const [method, path] of [
      ['POST', '/workers'],
      ['POST', '/publish'],
      ['POST', '/leases'],
      ['POST', '/dispatch'],
      ['GET', '/work-proposals']
    ] as const) {
      const response = await fetch(`${url}${path}`, { method })
      assert.equal(response.status, 404, `${method} ${path} should be 404`)
    }
  })
})

test('GET on /health still works alongside admission surface', async () => {
  await withServer({ admission: admittingHandler() }, async (url) => {
    const health = await fetch(`${url}/health`)
    assert.equal(health.status, 200)
    const other = await fetch(`${url}/nope`)
    assert.equal(other.status, 404)
  })
})
