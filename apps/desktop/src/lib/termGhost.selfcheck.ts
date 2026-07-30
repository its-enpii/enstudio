/**
 * Run: npx tsx apps/desktop/src/lib/termGhost.selfcheck.ts
 * ponytail: real xterm integration test when e2e harness exists.
 */
import assert from 'node:assert/strict'
import {
  applyMirrorData,
  commandToken,
  createMirror,
  ghostSuffix,
  pickBestMatch,
  shouldShowGhost,
} from './termGhost.js'

const m = createMirror()
applyMirrorData(m, 'gi')
assert.equal(commandToken(m), 'gi')
assert.equal(ghostSuffix('gi', 'git'), 't')
assert.equal(pickBestMatch(['git', 'gimp'], 'gi'), 'git')
assert.equal(shouldShowGhost({ altScreen: false, token: 'gi', match: 'git' }), true)
assert.equal(shouldShowGhost({ altScreen: true, token: 'gi', match: 'git' }), false)
applyMirrorData(m, 't ')
assert.equal(commandToken(m), null) // args — no PATH ghost
applyMirrorData(m, '\r')
assert.equal(m.buf, '')
applyMirrorData(m, 'no')
assert.equal(commandToken(m), 'no')
console.log('termGhost.selfcheck ok')
