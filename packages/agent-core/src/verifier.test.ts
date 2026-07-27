import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { discoverVerificationCommands, goalPrompt, parseVerifierResponse } from './verifier.js'

test('parseVerifierResponse accepts fenced JSON', () => {
  const result = parseVerifierResponse('```json\n{"passed":true,"summary":"done","failures":[]}\n```')
  assert.equal(result.passed, true)
  assert.equal(result.summary, 'done')
})

test('parseVerifierResponse fails closed', () => {
  const result = parseVerifierResponse('looks good')
  assert.equal(result.passed, false)
  assert.match(result.summary, /invalid JSON/)
})

test('goalPrompt includes explicit criteria', () => {
  assert.match(goalPrompt({ goal: 'ship', acceptanceCriteria: ['tests pass'] }), /tests pass/)
})

test('discoverVerificationCommands prefers typecheck', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-verify-'))
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', typecheck: 'tsc --noEmit' } }))
    assert.deepEqual(discoverVerificationCommands(root), ['npm run typecheck'])
    assert.deepEqual(discoverVerificationCommands(root, ['npm test']), ['npm test'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
