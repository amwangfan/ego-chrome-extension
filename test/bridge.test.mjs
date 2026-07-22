import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { startBridge } from '../src/bridge.mjs'

const token = 'a'.repeat(64)
const headers = { authorization: `Bearer ${token}` }

test('bridge reports extension connection and forwards RPC', async (t) => {
  const server = startBridge({ host: '127.0.0.1', port: 0, token }, { logger: { info() {} } })
  await once(server, 'listening')
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`

  const poll = fetch(`${base}/extension/next`, {
    headers: { ...headers, origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  const rpc = fetch(`${base}/rpc`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'tabs.list', params: {} }),
  })

  const pollResponse = await poll
  assert.equal(pollResponse.status, 200)
  const request = await pollResponse.json()
  assert.equal(request.method, 'tabs.list')

  const resultResponse = await fetch(`${base}/extension/result`, {
    method: 'POST',
    headers: { ...headers, origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'content-type': 'application/json' },
    body: JSON.stringify({ id: request.id, result: [{ id: 7 }] }),
  })
  assert.equal(resultResponse.status, 200)

  const rpcResponse = await rpc
  assert.equal(rpcResponse.status, 200)
  assert.deepEqual(await rpcResponse.json(), { result: [{ id: 7 }] })
})
