import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { listPersisted, loadSession, projectHash, recoverTranscriptTail, saveSession } from './persist.js'
import { closeSessionIndex, indexGet, rebuildIndex } from './session-index.js'
import type { SessionMeta } from './types.js'

describe('persist', () => {
  const home = path.join(os.tmpdir(), `enpii-home-${Date.now()}`)
  const prevHome = process.env.ENPII_HOME

  before(() => {
    fs.mkdirSync(home, { recursive: true })
    process.env.ENPII_HOME = home
    closeSessionIndex()
  })

  after(() => {
    closeSessionIndex()
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('round-trips session json under project hash + SQLite index', () => {
    const root = path.join(os.tmpdir(), `enpii-persist-${Date.now()}`)
    fs.mkdirSync(root, { recursive: true })
    const meta: SessionMeta = {
      id: `sess-test-${Date.now()}`,
      contractVersion: '0.1.0',
      projectRoot: root,
      title: 't',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'enpii',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'idle',
    }
    saveSession(meta, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
    const hash = projectHash(root)
    assert.match(hash, /^[a-f0-9]{16}$/)
    const loaded = loadSession(root, meta.id)
    assert.ok(loaded)
    assert.equal(loaded.meta.id, meta.id)
    assert.equal(loaded.messages.length, 2)
    const listed = listPersisted(root)
    assert.ok(listed.some((s) => s.id === meta.id))
    const idx = indexGet(meta.id)
    assert.ok(idx)
    assert.equal(idx!.title, 't')
    assert.equal(idx!.model, 'enpii')
  })

  it('recovers a failed turn stored only in context messages', () => {
    const meta: SessionMeta = {
      id: 'failed-turn',
      contractVersion: '0.1.0',
      projectRoot: process.cwd(),
      title: 'failed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'test',
      dialect: 'openai' as const,
      permissionMode: 'ask' as const,
      status: 'error' as const,
    }
    const recovered = recoverTranscriptTail({
      meta,
      messages: [{ role: 'user', content: 'old' }],
      contextMessages: [
        { role: 'user', content: 'old' },
        { role: 'user', content: 'new request' },
        { role: 'assistant', content: 'partial work' },
      ],
    })
    assert.deepEqual(recovered.messages.map((message) => message.content), ['old', 'new request', 'partial work'])
  })

  it('rebuildIndex rescans JSON sessions', () => {
    const root = path.join(os.tmpdir(), `enpii-rebuild-${Date.now()}`)
    fs.mkdirSync(root, { recursive: true })
    const meta: SessionMeta = {
      id: `sess-rebuild-${Date.now()}`,
      contractVersion: '0.1.0',
      projectRoot: root,
      title: 'rebuild-me',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'enpii',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'idle',
    }
    saveSession(meta, [{ role: 'user', content: 'x' }])
    const n = rebuildIndex()
    assert.ok(n >= 1)
    assert.equal(indexGet(meta.id)?.title, 'rebuild-me')
  })
})
