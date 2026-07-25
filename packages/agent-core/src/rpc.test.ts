import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { SessionStore } from './session.js'
import { sameProject } from './persist.js'

describe('SessionStore', () => {
  it('creates and gets session', () => {
    const store = new SessionStore()
    const root = `F:/demo-${randomUUID()}`
    const s = store.create({ projectRoot: root, title: 't1' })
    assert.ok(sameProject(s.projectRoot, root))
    assert.equal(s.projectRoot, path.resolve(root))
    assert.equal(s.title, 't1')
    assert.equal(store.get(s.id)?.id, s.id)
  })

  it('lists by project', () => {
    const store = new SessionStore()
    const a = `A-${randomUUID()}`
    const b = `B-${randomUUID()}`
    store.create({ projectRoot: a, title: 'a' })
    store.create({ projectRoot: b, title: 'b' })
    assert.equal(store.list(a).length, 1)
    assert.ok(store.list().length >= 2)
  })

  it('resume latest without sessionId', () => {
    const store = new SessionStore()
    const root = `R-${randomUUID()}`
    const first = store.create({ projectRoot: root, title: 'first' })
    store.setMessages(first.id, [{ role: 'user', content: 'hi' }])
    const again = store.upsert({ projectRoot: root })
    assert.equal(again.id, first.id)
    assert.equal(store.getMessages(again.id).length, 1)
  })
})
