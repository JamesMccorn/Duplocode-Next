import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeProxmoxLauncher } from './index.js'

const profile = { id: 'duplocode-worker-base-v1', imageDigest: 'sha256:image', compositionDigest: 'sha256:composition', pool: 'builder-arms', node: 'pve2' } as const
test('a lost worker survives as a receipt and must be explicitly destroyed', async () => {
  const launcher = new FakeProxmoxLauncher()
  await launcher.provision('run-1', profile)
  await assert.rejects(launcher.destroy('run-1'), /terminal receipt/)
  assert.equal((await launcher.declareLost('run-1', 'heartbeat unavailable')).state, 'lost')
  assert.equal((await launcher.destroy('run-1')).state, 'destroyed')
})
