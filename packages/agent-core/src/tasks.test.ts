import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, before, after } from 'node:test'
import {
  taskClearBoard,
  taskCreate,
  taskGet,
  taskList,
  taskStop,
  taskUpdate,
} from './tasks.js'
import { runTool } from './tools/run.js'

describe('durable task board', () => {
  let root: string
  let prevHome: string | undefined

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-tasks-'))
    prevHome = process.env.ENPII_HOME
    process.env.ENPII_HOME = path.join(root, 'home')
  })

  after(() => {
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('create list get update stop persists', () => {
    taskClearBoard(root)
    const a = taskCreate(root, { title: 'Inspect code', detail: 'Read entrypoints' })
    assert.equal(a.ok, true)
    if (!a.ok) return
    const b = taskCreate(root, {
      title: 'Implement fix',
      status: 'pending',
      blockedBy: [a.task.id],
    })
    assert.equal(b.ok, true)
    if (!b.ok) return

    const listed = taskList(root)
    assert.equal(listed.tasks.length, 2)
    assert.match(listed.content, /Inspect code/)

    const got = taskGet(root, a.task.id)
    assert.equal(got.ok, true)
    if (!got.ok) return
    assert.equal(got.task.title, 'Inspect code')

    const upd = taskUpdate(root, {
      taskId: a.task.id,
      status: 'in_progress',
      progress: 40,
      note: 'halfway',
    })
    assert.equal(upd.ok, true)
    if (!upd.ok) return
    assert.equal(upd.task.status, 'in_progress')
    assert.equal(upd.task.progress, 40)

    const done = taskUpdate(root, { taskId: a.task.id, status: 'completed', progress: 100 })
    assert.equal(done.ok, true)
    if (!done.ok) return
    // Auto-unblock: completing A clears B.blockedBy without manual removeBlockedBy
    assert.deepEqual(done.unblocked, [b.task.id])
    assert.match(done.content, /Auto-unblocked/)
    const bAfter = taskGet(root, b.task.id)
    assert.equal(bAfter.ok, true)
    if (!bAfter.ok) return
    assert.equal(bAfter.task.blockedBy.length, 0)
    assert.equal(bAfter.task.status, 'pending')

    // Manual remove/clear still work
    const reblock = taskUpdate(root, { taskId: b.task.id, addBlockedBy: [a.task.id] })
    assert.equal(reblock.ok, true)
    if (!reblock.ok) return
    assert.equal(reblock.task.blockedBy.length, 1)
    const cleared = taskUpdate(root, { taskId: b.task.id, clearBlockedBy: true })
    assert.equal(cleared.ok, true)
    if (!cleared.ok) return
    assert.equal(cleared.task.blockedBy.length, 0)

    // Cancel also auto-unblocks dependents
    const c = taskCreate(root, { title: 'Depends on B', blockedBy: [b.task.id] })
    assert.equal(c.ok, true)
    if (!c.ok) return
    const stop = taskStop(root, b.task.id)
    assert.equal(stop.ok, true)
    if (!stop.ok) return
    assert.equal(stop.task.status, 'cancelled')
    assert.ok(stop.unblocked?.includes(c.task.id))
    const cAfter = taskGet(root, c.task.id)
    assert.equal(cAfter.ok, true)
    if (!cAfter.ok) return
    assert.equal(cAfter.task.blockedBy.length, 0)

    // reload from disk
    const again = taskList(root)
    assert.equal(again.tasks.length, 3)
    assert.equal(again.tasks.find((t) => t.id === a.task.id)?.status, 'completed')
    assert.equal(again.tasks.find((t) => t.id === b.task.id)?.status, 'cancelled')
  })

  it('runTool wiring', async () => {
    taskClearBoard(root)
    const c = await runTool(root, 'task_create', JSON.stringify({ title: 'Via tool' }))
    assert.equal(c.ok, true)
    assert.match(c.content, /Via tool/)
    const list = await runTool(root, 'task_list', '{}')
    assert.equal(list.ok, true)
    assert.match(list.content, /Via tool/)
  })

  it('rejects empty title and bad progress', () => {
    taskClearBoard(root)
    const bad = taskCreate(root, { title: '  ' })
    assert.equal(bad.ok, false)
    const t = taskCreate(root, { title: 'x' })
    assert.equal(t.ok, true)
    if (!t.ok) return
    const p = taskUpdate(root, { taskId: t.task.id, progress: 150 })
    assert.equal(p.ok, false)
  })
})
