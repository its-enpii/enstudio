import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { listPersisted, loadSession, projectHash, saveSession } from './persist.js'
import type { SessionMeta } from './types.js'

describe('persist', () => {
  it('round-trips session json under project hash', () => {
    const root = path.join(os.tmpdir(), `enpii-persist-${Date.now()}`)
    fs.mkdirSync(root, { recursive: true })
    const meta: SessionMeta = {
      id: 'sess-test-1',
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
  })
})
