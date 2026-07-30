import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyGuardrails,
  defaultGuardrailsConfig,
  resolveGuardrailsConfig,
  type GuardrailsConfig,
} from './guardrails.js'

test('redacts api keys on tool surface', () => {
  const cfg = defaultGuardrailsConfig()
  const raw = 'token sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 and done'
  const r = applyGuardrails(raw, cfg, 'tool')
  assert.match(r.text, /REDACTED_API_KEY/)
  assert.doesNotMatch(r.text, /sk-ant-api03/)
  assert.ok(r.hits.includes('api_key'))
})

test('disabled config is no-op', () => {
  const cfg: GuardrailsConfig = { ...defaultGuardrailsConfig(), enabled: false }
  const raw = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345'
  assert.equal(applyGuardrails(raw, cfg, 'tool').text, raw)
})

test('input off by default', () => {
  const cfg = defaultGuardrailsConfig()
  const raw = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345'
  assert.equal(applyGuardrails(raw, cfg, 'input').text, raw)
})

test('block strategy stops', () => {
  const cfg: GuardrailsConfig = {
    enabled: true,
    applyToInput: true,
    rules: [{ type: 'api_key', strategy: 'block' }],
  }
  const r = applyGuardrails('here sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345', cfg, 'input')
  assert.ok(r.blocked)
  assert.ok(r.hits.includes('api_key'))
})

test('email redact when enabled', () => {
  const cfg: GuardrailsConfig = {
    enabled: true,
    applyToOutput: true,
    rules: [{ type: 'email', strategy: 'redact' }],
  }
  const r = applyGuardrails('mail me at dev@example.com please', cfg, 'output')
  assert.match(r.text, /REDACTED_EMAIL/)
  assert.doesNotMatch(r.text, /dev@example\.com/)
})

test('mask keeps last 4', () => {
  const cfg: GuardrailsConfig = {
    enabled: true,
    applyToToolResults: true,
    rules: [{ type: 'aws_key', strategy: 'mask' }],
  }
  const key = 'AKIAIOSFODNN7EXAMPLE'
  const r = applyGuardrails(`id ${key}`, cfg, 'tool')
  assert.match(r.text, /\*+MPLE/)
  assert.doesNotMatch(r.text, /AKIAIOSFODNN7EXAMPLE/)
})

test('private key block redacted', () => {
  const pem = `-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----`
  const r = applyGuardrails(pem, defaultGuardrailsConfig(), 'tool')
  assert.match(r.text, /REDACTED_PRIVATE_KEY/)
})

test('resolveGuardrailsConfig can disable', () => {
  assert.equal(resolveGuardrailsConfig({ enabled: false }).enabled, false)
  assert.equal(resolveGuardrailsConfig(undefined).enabled, true)
})
