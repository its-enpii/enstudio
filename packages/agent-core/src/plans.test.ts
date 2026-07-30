import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  approvePlan,
  latestPlan,
  listPlans,
  planContextPrompt,
  readPlan,
  rejectPlan,
  savePlan,
} from './plans.js'
import { runTool } from './tools/run.js'
import { projectHash } from './persist.js'

describe('durable plans', () => {
  let root: string
  let prevHome: string | undefined
  let home: string

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-plans-'))
    home = path.join(root, 'home')
    prevHome = process.env.ENPII_HOME
    process.env.ENPII_HOME = home
    fs.mkdirSync(path.join(root, 'proj'), { recursive: true })
  })

  after(() => {
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    fs.rmSync(root, { recursive: true, force: true })
  })

  const proj = () => path.join(root, 'proj')

  it('savePlan writes draft md under projects/<hash>/plans', () => {
    const saved = savePlan(proj(), {
      title: 'Ship fix',
      sessionId: 'sess-1',
      steps: [
        { title: 'Inspect entry', detail: 'Read main' },
        { title: 'Apply patch' },
        { title: 'Run tests' },
      ],
    })
    assert.equal(saved.ok, true)
    if (!saved.ok) return
    assert.equal(saved.plan.status, 'draft')
    assert.ok(fs.existsSync(saved.plan.path))
    const raw = fs.readFileSync(saved.plan.path, 'utf8')
    assert.match(raw, /status: draft/)
    assert.match(raw, /Inspect entry/)
    assert.match(raw, /Apply patch/)
    const expectedDir = path.join(home, 'projects', projectHash(proj()), 'plans')
    assert.equal(path.dirname(saved.plan.path), expectedDir)
    assert.equal(latestPlan(proj())?.id, saved.plan.id)
  })

  it('approvePlan flips latest draft to approved', () => {
    const draft = latestPlan(proj(), 'draft')
    assert.ok(draft)
    const approved = approvePlan(proj())
    assert.equal(approved.ok, true)
    if (!approved.ok) return
    assert.equal(approved.plan.status, 'approved')
    assert.equal(readPlan(proj(), approved.plan.id)?.status, 'approved')
    const raw = fs.readFileSync(approved.plan.path, 'utf8')
    assert.match(raw, /status: approved/)
  })

  it('plan_tasks tool persists draft', async () => {
    const result = await runTool(
      proj(),
      'plan_tasks',
      JSON.stringify({
        tasks: [
          { title: 'Map modules' },
          { title: 'Write changes', detail: 'Touch loop' },
        ],
      }),
      { sessionId: 'sess-tool' },
    )
    assert.equal(result.ok, true)
    const body = JSON.parse(result.content) as {
      planId?: string
      path?: string
      status?: string
      tasks: unknown[]
    }
    assert.ok(body.planId)
    assert.equal(body.status, 'draft')
    assert.ok(body.path?.includes('plans/'))
    assert.equal(body.tasks.length, 2)
    assert.ok(listPlans(proj()).some((p) => p.id === body.planId))
  })

  it('rejectPlan + planContextPrompt surface disk plan', () => {
    const saved = savePlan(proj(), {
      title: 'Reject me',
      steps: [{ title: 'Step A' }, { title: 'Step B' }],
    })
    assert.equal(saved.ok, true)
    if (!saved.ok) return
    const rejected = rejectPlan(proj(), saved.plan.id)
    assert.equal(rejected.ok, true)
    if (!rejected.ok) return
    assert.equal(rejected.plan.status, 'rejected')
    // New draft + approve for context prompt
    const d2 = savePlan(proj(), {
      title: 'Do work',
      steps: [{ title: 'Read' }, { title: 'Write' }],
    })
    assert.equal(d2.ok, true)
    if (!d2.ok) return
    approvePlan(proj(), d2.plan.id)
    const block = planContextPrompt(proj())
    assert.match(block, /APPROVED/)
    assert.match(block, /Do work|Read/)
    assert.match(block, /task_create/)
  })

  it('rejects fewer than 2 steps', () => {
    const bad = savePlan(proj(), { steps: [{ title: 'Only one' }] })
    assert.equal(bad.ok, false)
  })
})
