import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { formatProjectFile } from './formatter.js'

test('formats JSON without external formatter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-format-'))
  try {
    const result = formatProjectFile(root, 'data.json', '{"ok":true,"items":[1,2]}')
    assert.equal(result.formatter, 'JSON')
    assert.match(result.content, /\n  "ok": true/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('basic formatter trims trailing whitespace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-format-'))
  try {
    const result = formatProjectFile(root, 'notes.txt', 'one   \n\ntwo')
    assert.equal(result.formatter, 'Basic whitespace')
    assert.equal(result.content, 'one\n\ntwo\n')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
