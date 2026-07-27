import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import {
  clearLiveSubAgents,
  listSubAgents,
  messageSubAgent,
  spawnSubAgent,
  stopSubAgent,
} from './subagent.js'
import type { ProviderConfig } from './config.js'
import type { SessionMeta } from './types.js'

function git(root: string, ...args: string[]): void {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'git failed')
}

const mockConfig: ProviderConfig = {
  baseUrl: 'http://127.0.0.1:9',
  apiKey: 'test',
  model: 'test',
  dialect: 'openai',
  permissionMode: 'ask',
}

describe('subagent registry', () => {
  let root: string
  let prevHome: string | undefined

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-sub-'))
    prevHome = process.env.ENPII_HOME
    process.env.ENPII_HOME = path.join(root, 'home')
    clearLiveSubAgents()
    git(root, 'init')
    git(root, 'config', 'user.name', 'enpii test')
    git(root, 'config', 'user.email', 'test@enpii.local')
    fs.writeFileSync(path.join(root, 'note.txt'), 'one\n', 'utf8')
    git(root, 'add', 'note.txt')
    git(root, 'commit', '-m', 'initial')
  })

  after(() => {
    clearLiveSubAgents()
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects empty prompt', async () => {
    const parent: SessionMeta = {
      id: 'p1',
      contractVersion: '0.1.0',
      projectRoot: root,
      title: 'parent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'test',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'idle',
    }
    const r = await spawnSubAgent({
      baseRoot: root,
      parentMeta: parent,
      config: mockConfig,
      description: 'x',
      prompt: '  ',
      isolation: 'shared',
    })
    assert.equal(r.ok, false)
  })

  it('send_message fails without live agent', async () => {
    const r = await messageSubAgent({
      agentId: 'deadbeef',
      message: 'hi',
      config: mockConfig,
    })
    assert.equal(r.ok, false)
    assert.match(r.content, /No live/)
  })

  it('stop unknown fails', () => {
    const r = stopSubAgent('nope')
    assert.equal(r.ok, false)
  })

  it('list empty project starts empty', () => {
    clearLiveSubAgents()
    assert.equal(listSubAgents(root).length, 0)
  })
})
