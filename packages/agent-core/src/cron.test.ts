import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  canFireCron,
  collectDueCronJobs,
  cronCreate,
  cronDelete,
  cronList,
  cronMarkRan,
  cronMatches,
  cronToggle,
  FAIL_STREAK_DISABLE,
  MAX_FIRES_PER_HOUR,
  nextCronFire,
  recordCronFire,
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

test('cronMarkRan auto-disables after fail streak', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-cron-fail-'))
  const prev = process.env.ENPII_HOME
  process.env.ENPII_HOME = home
  const root = path.join(home, 'proj')
  fs.mkdirSync(root, { recursive: true })
  try {
    const created = cronCreate(root, {
      name: 'flaky',
      schedule: '0 3 * * *',
      prompt: 'nightly',
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    for (let i = 0; i < FAIL_STREAK_DISABLE - 1; i++) {
      const r = cronMarkRan(root, created.job.id, { ok: false, error: `boom${i}` })
      assert.notEqual(r.disabled, true)
      assert.equal(cronList(root).jobs[0]!.enabled, true)
    }
    const last = cronMarkRan(root, created.job.id, { ok: false, error: 'final' })
    assert.equal(last.disabled, true)
    const job = cronList(root).jobs[0]!
    assert.equal(job.enabled, false)
    assert.equal(job.failStreak, FAIL_STREAK_DISABLE)
    assert.match(job.lastError ?? '', /auto-disabled/)
  } finally {
    if (prev === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('hourly fire budget blocks after MAX_FIRES_PER_HOUR', () => {
  const now = Date.now()
  for (let i = 0; i < MAX_FIRES_PER_HOUR; i++) recordCronFire(now)
  const blocked = canFireCron(now)
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.match(blocked.reason, /hourly/)
})
