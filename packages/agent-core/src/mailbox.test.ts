import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mailboxBroadcast, mailboxPeek, mailboxReceive, mailboxSend } from './mailbox.js'

test('mailbox send/peek/receive consume', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-mail-'))
  const prev = process.env.ENPII_HOME
  process.env.ENPII_HOME = home
  const root = path.join(home, 'proj')
  fs.mkdirSync(root, { recursive: true })
  try {
    const s = mailboxSend(root, { from: 'main', to: 'worker', content: 'hello' })
    assert.equal(s.ok, true)
    const peek = mailboxPeek(root, 'worker')
    assert.equal(peek.ok, true)
    if (peek.ok) assert.equal(peek.messages.length, 1)
    const again = mailboxPeek(root, 'worker')
    if (again.ok) assert.equal(again.messages.length, 1)
    const recv = mailboxReceive(root, 'worker')
    assert.equal(recv.ok, true)
    if (recv.ok) {
      assert.equal(recv.messages.length, 1)
      assert.match(recv.messages[0]!.content, /hello/)
    }
    const empty = mailboxReceive(root, 'worker')
    if (empty.ok) assert.equal(empty.messages.length, 0)
  } finally {
    if (prev === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('mailbox rejects path traversal to', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-mail2-'))
  const prev = process.env.ENPII_HOME
  process.env.ENPII_HOME = home
  const root = path.join(home, 'proj')
  fs.mkdirSync(root, { recursive: true })
  try {
    const bad = mailboxSend(root, { to: '../x', content: 'nope' })
    assert.equal(bad.ok, false)
  } finally {
    if (prev === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('mailbox broadcast hits main and known agents', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-mail3-'))
  const prev = process.env.ENPII_HOME
  process.env.ENPII_HOME = home
  const root = path.join(home, 'proj')
  fs.mkdirSync(root, { recursive: true })
  try {
    mailboxSend(root, { from: 'main', to: 'a1', content: 'seed' })
    const b = mailboxBroadcast(root, { from: 'lead', content: 'all hands', agents: ['a2'] })
    assert.equal(b.ok, true)
    if (b.ok) assert.ok(b.sent >= 2)
    const main = mailboxPeek(root, 'main')
    if (main.ok) assert.ok(main.messages.some((m) => m.content.includes('all hands')))
  } finally {
    if (prev === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  }
})
