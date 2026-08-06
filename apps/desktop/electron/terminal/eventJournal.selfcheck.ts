/** Run: npx tsx apps/desktop/electron/terminal/eventJournal.selfcheck.ts */
import assert from 'node:assert/strict'
import { EventJournal } from './eventJournal.js'

type TestEvent = { sequence: number; value: string }

const journal = new EventJournal<TestEvent>(3)
assert.deepEqual(journal.replay(), { events: [], truncatedBeforeSequence: undefined })
assert.equal(journal.latestSequence(), 0)

journal.append({ sequence: 1, value: 'one' })
journal.append({ sequence: 2, value: 'two' })
journal.append({ sequence: 3, value: 'three' })
assert.deepEqual(journal.replay(1).events.map((event) => event.value), ['two', 'three'])
assert.equal(journal.latestSequence(), 3)

journal.append({ sequence: 4, value: 'four' })
const truncated = journal.replay(0)
assert.equal(truncated.truncatedBeforeSequence, 2)
assert.deepEqual(truncated.events.map((event) => event.sequence), [2, 3, 4])
assert.equal(journal.replay(2).truncatedBeforeSequence, undefined)
assert.deepEqual(journal.replay(3).events, [{ sequence: 4, value: 'four' }])

assert.throws(() => journal.append({ sequence: 4, value: 'duplicate' }), /must increase/)
assert.throws(() => new EventJournal<TestEvent>(0), /positive integer/)

console.log('terminal eventJournal.selfcheck ok')
