/** Run: npx tsx apps/desktop/electron/terminal/shellMarkerParser.selfcheck.ts */
import assert from 'node:assert/strict'
import { ShellMarkerParser } from './shellMarkerParser.js'

const nonce = 'test-nonce'
const encode = (payload: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
const frame = (event: string, payload: Record<string, unknown>, frameNonce = nonce): string =>
  `\x1b]633;EnStudio;1;${frameNonce};${event};${encode(payload)}\x07`

const split = new ShellMarkerParser(nonce)
assert.deepEqual(split.push('before\x1b]633;EnStu'), [{ type: 'data', data: 'before' }])
assert.deepEqual(
  split.push(`dio;1;${nonce};prompt_ready;${encode({ cwd: 'C:\\repo' })}\x07after`),
  [
    { type: 'marker', marker: { event: 'prompt_ready', payload: { cwd: 'C:\\repo' } } },
    { type: 'data', data: 'after' },
  ],
)

const multiple = new ShellMarkerParser(nonce)
assert.deepEqual(
  multiple.push(`${frame('command_start', { command: 'npm test' })}${frame('command_end', { exitCode: 0 })}`),
  [
    { type: 'marker', marker: { event: 'command_start', payload: { command: 'npm test' } } },
    { type: 'marker', marker: { event: 'command_end', payload: { exitCode: 0 } } },
  ],
)

const wrongNonce = frame('prompt_ready', { cwd: 'C:\\repo' }, 'wrong')
assert.deepEqual(new ShellMarkerParser(nonce).push(wrongNonce), [{ type: 'data', data: wrongNonce }])

const unknownEvent = frame('unknown', { cwd: 'C:\\repo' })
assert.deepEqual(new ShellMarkerParser(nonce).push(unknownEvent), [{ type: 'data', data: unknownEvent }])

const invalid = `\x1b]633;EnStudio;1;${nonce};prompt_ready;not-json\x07`
assert.deepEqual(new ShellMarkerParser(nonce).push(invalid), [{ type: 'data', data: invalid }])

const oversized = `\x1b]633;EnStudio;${'x'.repeat(70 * 1024)}`
assert.deepEqual(new ShellMarkerParser(nonce).push(oversized), [{ type: 'data', data: oversized }])

console.log('terminal shellMarkerParser.selfcheck ok')
