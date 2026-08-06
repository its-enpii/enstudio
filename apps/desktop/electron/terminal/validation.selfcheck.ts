/** Run: npx tsx apps/desktop/electron/terminal/validation.selfcheck.ts */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clampTerminalCols,
  clampTerminalRows,
  normalizeTerminalArgs,
  normalizeTerminalId,
  normalizeTerminalWrite,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MAX_WRITE_BYTES,
  validateTerminalCwd,
} from './validation.js'

assert.equal(clampTerminalCols(undefined), 80)
assert.equal(clampTerminalCols(1), 2)
assert.equal(clampTerminalCols(Infinity), 80)
assert.equal(clampTerminalCols(TERMINAL_MAX_COLS + 1), TERMINAL_MAX_COLS)
assert.equal(clampTerminalRows(undefined), 24)
assert.equal(clampTerminalRows(0), 1)
assert.equal(clampTerminalRows(TERMINAL_MAX_ROWS + 1), TERMINAL_MAX_ROWS)

assert.deepEqual(normalizeTerminalArgs(undefined), [])
assert.deepEqual(normalizeTerminalArgs(['ssh', 22]), ['ssh', '22'])
assert.throws(() => normalizeTerminalArgs('ssh'), /must be an array/)

assert.equal(normalizeTerminalId('terminal-1'), 'terminal-1')
assert.throws(() => normalizeTerminalId(''), /id is required/)
assert.equal(normalizeTerminalWrite('hello'), 'hello')
assert.throws(() => normalizeTerminalWrite(Buffer.alloc(1)), /must be a string/)
assert.throws(
  () => normalizeTerminalWrite('x'.repeat(TERMINAL_MAX_WRITE_BYTES + 1)),
  /exceeds/,
)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enstudio-terminal-validation-'))
try {
  assert.equal(validateTerminalCwd(undefined, root), path.resolve(root))
  const file = path.join(root, 'file.txt')
  fs.writeFileSync(file, 'test')
  assert.throws(() => validateTerminalCwd(file, root), /not a directory/)
  assert.throws(() => validateTerminalCwd(path.join(root, 'missing'), root), /not found/)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('terminal validation.selfcheck ok')
