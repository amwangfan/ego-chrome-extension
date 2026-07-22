import test from 'node:test'
import assert from 'node:assert/strict'
import { matchUrl, serializeEvaluation } from '../src/runtime.mjs'

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
