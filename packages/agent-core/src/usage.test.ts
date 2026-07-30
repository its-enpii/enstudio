import assert from 'node:assert/strict'
import test from 'node:test'
import { addNormalizedUsage, freshPromptTokens, normalizeUsage } from './usage.js'

test('normalizeUsage OpenAI + cache details', () => {
  const u = normalizeUsage({
    prompt_tokens: 41300,
    completion_tokens: 85,
    total_tokens: 41385,
    prompt_tokens_details: { cached_tokens: 40448 },
  })
  assert.ok(u)
  assert.equal(u!.prompt_tokens, 41300)
  assert.equal(u!.completion_tokens, 85)
  assert.equal(u!.cached_tokens, 40448)
  assert.equal(freshPromptTokens(u!), 41300 - 40448)
})

test('normalizeUsage Anthropic fields', () => {
  const u = normalizeUsage({
    input_tokens: 1000,
    output_tokens: 50,
    cache_read_input_tokens: 800,
  })
  assert.ok(u)
  assert.equal(u!.prompt_tokens, 1000)
  assert.equal(u!.completion_tokens, 50)
  assert.equal(u!.cached_tokens, 800)
  assert.equal(u!.total_tokens, 1050)
})

test('normalizeUsage empty → undefined', () => {
  assert.equal(normalizeUsage(null), undefined)
  assert.equal(normalizeUsage({}), undefined)
})

test('addNormalizedUsage sums cache', () => {
  const a = normalizeUsage({ prompt_tokens: 100, completion_tokens: 10, cached_tokens: 40 })!
  const b = normalizeUsage({ prompt_tokens: 200, completion_tokens: 5, cached_tokens: 150 })!
  const s = addNormalizedUsage(a, b)!
  assert.equal(s.prompt_tokens, 300)
  assert.equal(s.completion_tokens, 15)
  assert.equal(s.cached_tokens, 190)
})
