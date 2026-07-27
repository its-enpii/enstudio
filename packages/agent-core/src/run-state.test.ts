import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRunState, normalizeGoal, updateRunState } from './run-state.js'

test('goal contract clamps unsafe budgets and checkpoints atomically', () => {
  const goal = normalizeGoal({ goal: 'ship feature', maxRounds: 999, maxTokens: 1, maxRepairAttempts: 99 }, 'fallback')
  assert.equal(goal.goal, 'ship feature')
  assert.equal(goal.maxRounds, 32)
  assert.equal(goal.maxTokens, 1_000)
  assert.equal(goal.maxRepairAttempts, 3)
  const state = createRunState('test-session', goal)
  const next = updateRunState(state, { status: 'running', round: 1, repairAttempts: 1, lastEvent: 'checkpoint' })
  assert.equal(next.lastEvent, 'checkpoint')
  assert.equal(next.repairAttempts, 1)
  const dir = path.join(os.homedir(), '.enpiistudio', 'runs', 'test-session')
  assert.ok(fs.existsSync(dir))
  fs.rmSync(path.join(dir, `${state.runId}.json`), { force: true })
})

test('goal contract falls back to prompt text', () => {
  assert.equal(normalizeGoal(undefined, 'inspect project').goal, 'inspect project')
  assert.throws(() => normalizeGoal(undefined, '  '), /goal is required/)
})

test('goal contract normalizes explicit verification commands', () => {
  const goal = normalizeGoal({ goal: 'ship', verificationCommands: [' npm test ', '', 42] }, 'fallback')
  assert.deepEqual(goal.verificationCommands, ['npm test'])
})
