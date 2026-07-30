import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAskOptions } from './ask-options.js'

test('normalizeAskOptions accepts strings and rich objects', () => {
  const opts = normalizeAskOptions([
    'plain',
    { label: 'Rich', description: 'with detail', recommended: true },
    { title: 'Alias', detail: 'via title/detail' },
    '  ',
    { label: '' },
  ])
  assert.ok(opts)
  assert.equal(opts!.length, 3)
  assert.deepEqual(opts![0], { label: 'plain' })
  assert.equal(opts![1]!.label, 'Rich')
  assert.equal(opts![1]!.description, 'with detail')
  assert.equal(opts![1]!.recommended, true)
  assert.equal(opts![2]!.label, 'Alias')
  assert.equal(opts![2]!.description, 'via title/detail')
})

test('normalizeAskOptions caps at 6', () => {
  const opts = normalizeAskOptions(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  assert.equal(opts?.length, 6)
})

test('normalizeAskOptions empty → undefined', () => {
  assert.equal(normalizeAskOptions([]), undefined)
  assert.equal(normalizeAskOptions(null), undefined)
  assert.equal(normalizeAskOptions('x'), undefined)
})
