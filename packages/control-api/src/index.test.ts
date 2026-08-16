import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { createControlServer } from './index.js'

test('health endpoint exposes no governance authority', async () => {
  const server = createControlServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const response = await fetch(`http://127.0.0.1:${address.port}/health`)
  assert.deepEqual(await response.json(), { status: 'ok' })
  server.close(); await once(server, 'close')
})
