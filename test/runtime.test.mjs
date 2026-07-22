import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime, matchUrl, serializeEvaluation } from '../src/runtime.mjs'

test('URL matching modes', () => {
  assert.equal(matchUrl('https://example.com/a/', 'https://example.com/a', 'origin+path'), true)
  assert.equal(matchUrl('https://example.com/a?q=1', 'https://example.com/b', 'origin'), true)
  assert.equal(matchUrl('https://example.com/a', '/a', 'exact'), false)
  assert.equal(matchUrl('https://example.com/orders/1', '/orders/', 'includes'), true)
})

test('page evaluation serializes functions and arguments', () => {
  const expression = serializeEvaluation((value) => value.answer, { answer: 42 })
  assert.equal(Function(`return ${expression}`)(), 42)
})

test('selected tab persists through bridge session calls', async () => {
  let remembered = null
  const calls = []
  const rpc = {
    async request(method, params = {}) {
      calls.push({ method, params })
      if (method === 'bridge.session.currentTab') return remembered ? { tabId: remembered } : null
      if (method === 'bridge.session.selectTab') {
        remembered = params.tabId
        return { tabId: remembered }
      }
      if (method === 'bridge.session.clearTab') {
        remembered = null
        return { cleared: true }
      }
      if (method === 'tabs.list') return [{ id: 7, url: 'https://example.com', title: 'Example' }]
      if (method === 'tabs.active') return { id: 3, url: 'https://active.example', title: 'Active' }
      if (method === 'page.info') return { url: 'https://example.com/search?q=youtube', title: 'Search' }
      throw new Error(`unexpected method ${method}`)
    },
  }

  const first = createRuntime(rpc)
  await first.browser.useTab(7)
  const second = createRuntime(rpc)
  assert.equal((await second.browser.currentTab()).id, 7)
  assert.equal(await second.page.waitForURL((url) => url.searchParams.get('q') === 'youtube'), 'https://example.com/search?q=youtube')
  assert.ok(calls.some((call) => call.method === 'bridge.session.selectTab'))
})
