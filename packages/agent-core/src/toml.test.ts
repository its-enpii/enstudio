import assert from 'node:assert/strict'
import test from 'node:test'
import { parseToml, stringifyToml, tomlString, tomlStringArray } from './toml.js'

test('parseToml flat keys + array + section', () => {
  const t = parseToml(`
# comment
baseUrl = "https://x/v1"
apiKey = "sk"
model = 'enpii'
dialect = "anthropic"
permissionMode = "ask"
denyGlobs = [".env", "**/secrets/**"]

[provider]
model = "override"
`)
  assert.equal(tomlString(t, 'baseUrl'), 'https://x/v1')
  assert.equal(tomlString(t, 'apiKey'), 'sk')
  assert.equal(tomlString(t, 'model'), 'enpii')
  assert.deepEqual(tomlStringArray(t, 'denyGlobs'), ['.env', '**/secrets/**'])
  assert.equal(tomlString(t, 'missing'), undefined)
  // section model available via provider fallback in tomlString for known keys only when root missing —
  // root model wins; check section directly
  const provider = t.provider as { model?: string }
  assert.equal(provider.model, 'override')
})

test('stringifyToml round-trip', () => {
  const raw = stringifyToml({
    baseUrl: 'https://ai.test/v1',
    model: 'm',
    dialect: 'openai',
    permissionMode: 'ask',
    denyGlobs: ['.env', 'id_rsa'],
  })
  assert.match(raw, /baseUrl = "https:\/\/ai\.test\/v1"/)
  const parsed = parseToml(raw)
  assert.equal(tomlString(parsed, 'model'), 'm')
  assert.deepEqual(tomlStringArray(parsed, 'denyGlobs'), ['.env', 'id_rsa'])
})
