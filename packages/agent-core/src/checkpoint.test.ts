import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkpointAccept, checkpointList, checkpointRollback, checkpointSnapshot, newCheckpointId } from './checkpoint.js'

test('checkpoint restores existing and removes newly created files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-checkpoint-'))
  try {
    fs.writeFileSync(path.join(root, 'existing.txt'), 'before\n')
    const id = newCheckpointId()
    checkpointSnapshot(root, id, 'existing.txt')
    checkpointSnapshot(root, id, 'new.txt')
    fs.writeFileSync(path.join(root, 'existing.txt'), 'after\n')
    fs.writeFileSync(path.join(root, 'new.txt'), 'new\n')

    assert.equal(checkpointList(root)[0]?.files.length, 2)
    checkpointRollback(root, id)
    assert.equal(fs.readFileSync(path.join(root, 'existing.txt'), 'utf8'), 'before\n')
    assert.equal(fs.existsSync(path.join(root, 'new.txt')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('checkpoint accepts one file or the whole turn', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-checkpoint-'))
  try {
    fs.writeFileSync(path.join(root, 'a.txt'), 'a')
    fs.writeFileSync(path.join(root, 'b.txt'), 'b')
    const id = newCheckpointId()
    checkpointSnapshot(root, id, 'a.txt', 'update files')
    checkpointSnapshot(root, id, 'b.txt', 'update files')
    assert.equal(checkpointList(root)[0]?.prompt, 'update files')
    assert.equal(checkpointAccept(root, id, 'a.txt')[0]?.files.length, 1)
    assert.equal(checkpointAccept(root, id).length, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
