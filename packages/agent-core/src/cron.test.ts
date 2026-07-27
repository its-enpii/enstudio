import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  collectDueCronJobs,
  cronCreate,
  cronDelete,
  cronList,
  cronMarkRan,
  cronMatches,
  cronToggle,
  nextCronFire,
  validateCronExpression,
} from './cron.js'

test('validateCronExpression accepts standard 5-field forms', () => {
  assert.equal(validateCronExpression('*/5 * * * *'), true)
  assert.equal(validateCronExpression('0 9 * * 1-5'), true)
  assert.equal(validateCronExpression('0 0 1 1 *'), true)
  assert.equal(validateCronExpression('bad'), false)
  assert.equal(validateCronExpression('* * *'), false)
  assert.equal(validateCronExpression('60 * * * *'), false)
})

test('cronMatches minute step and weekday range', () => {
  // 2026-07-27 is Monday
  const mon930 = new Date(2026, 6, 27, 9, 30, 0, 0)
  assert.equal(cronMatches('30 9 * * 1-5', mon930), true)
  assert.equal(cronMatches('0 9 * * 1-5', mon930), false)
  assert.equal(cronMatches('*/15 * * * *', mon930), true)
  assert.equal(cronMatches('*/15 * * * *', new Date(2026, 6, 27, 9, 31, 0, 0)), false)
})

test('nextCronFire advances past current minute', () => {
  const from = new Date(2026, 6, 27, 9, 0, 30, 0)
  const next = nextCronFire('5 9 * * *', from)
  assert.ok(next)
  assert.equal(next!.getHours(), 9)
  assert.equal(next!.getMinutes(), 5)
})

test('cron CRUD persists under ENPII_HOME', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-cron-'))
  const prev = process.env.ENPII_HOME
  process.env.ENPII_HOME = home
  const root = path.join(home, 'proj')
  fs.mkdirSync(root, { recursive: true })
  try {
    const created = cronCreate(root, {
      name: 'morning',
      schedule: '0 9 * * 1-5',
      prompt: 'check CI',
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.equal(created.job.name, 'morning')
    assert.ok(created.job.nextRunAt)

    const listed = cronList(root)
    assert.equal(listed.jobs.length, 1)

    const toggled = cronToggle(root, 'morning', false)
    assert.equal(toggled.ok, true)
    if (toggled.ok) assert.equal(toggled.job.enabled, false)

    const replaced = cronCreate(root, {
      name: 'morning',
      schedule: '*/10 * * * *',
      prompt: 'ping',
    })
    assert.equal(replaced.ok, true)
    if (replaced.ok) {
      assert.equal(replaced.job.schedule, '*/10 * * * *')
      assert.equal(replaced.job.enabled, true)
    }

    cronMarkRan(root, created.job.id, { ok: true, sessionId: 's1' })
    const after = cronList(root).jobs[0]!
    assert.equal(after.runCount, 1)
    assert.equal(after.lastSessionId, 's1')

    const del = cronDelete(root, 'morning')
    assert.equal(del.ok, true)
    assert.equal(cronList(root).jobs.length, 0)
  } finally {
    if (prev === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('collectDueCronJobs picks matching enabled jobs once per minute', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-cron-due-'))
  const prev = process.env.ENPII_HOME
  process.env.ENPII_HOME = home
  const root = path.join(home, 'proj')
  fs.mkdirSync(root, { recursive: true })
  try {
    // Use wall clock so cronMarkRan lastRunAt aligns with collectDue minute guard.
    const at = new Date()
    at.setSeconds(5, 0)
    const schedule = `${at.getMinutes()} * * * *`
    const created = cronCreate(root, {
      name: 'quarter',
      schedule,
      prompt: 'tick',
    })
    assert.equal(created.ok, true)
    const due = collectDueCronJobs(at)
    assert.ok(due.some((d) => d.job.name === 'quarter' && d.projectRoot === path.resolve(root)))
    if (created.ok) {
      cronMarkRan(root, created.job.id, { ok: true, sessionId: 'x' })
      const again = collectDueCronJobs(at)
      assert.equal(
        again.some((d) => d.job.id === created.job.id),
        false,
      )
    }
  } finally {
    if (prev === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  }
})
