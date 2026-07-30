import assert from 'node:assert/strict'
import test from 'node:test'
import { isMutatingTool, isParallelSafeTool, PARALLEL_SAFE_TOOL_NAMES } from './tools/defs.js'

test('parallel-safe tools are non-mutating', () => {
  for (const name of PARALLEL_SAFE_TOOL_NAMES) {
    // memory_store is in WRITE set but only put/delete mutate — listed separately below.
    if (name === 'memory_store') continue
    assert.equal(isMutatingTool(name), false, name)
    assert.equal(isParallelSafeTool(name), true, name)
  }
  assert.equal(isMutatingTool('memory_store', JSON.stringify({ op: 'get' })), false)
  assert.equal(isParallelSafeTool('memory_store', JSON.stringify({ op: 'get' })), true)
  assert.equal(isMutatingTool('memory_store', JSON.stringify({ op: 'put' })), true)
  assert.equal(isParallelSafeTool('memory_store', JSON.stringify({ op: 'put' })), false)
  assert.equal(isMutatingTool('handoff'), false)
  assert.equal(isParallelSafeTool('handoff'), true)
})

test('mutating tools are not parallel-safe', () => {
  for (const name of [
    'write_file',
    'edit_file',
    'run_shell',
    'git_commit',
    'mcp_call_tool',
    'memory_write',
    'agent',
    'send_message',
    'ask_user',
    'enter_plan_mode',
  ]) {
    assert.equal(isParallelSafeTool(name), false, name)
  }
})

test('batch contiguous reads: all-safe batch, mixed stops at mutate', () => {
  const names = ['read_file', 'grep', 'list_dir', 'write_file', 'read_file']
  const batches: string[][] = []
  let i = 0
  while (i < names.length) {
    if (isParallelSafeTool(names[i]!) && i + 1 < names.length && isParallelSafeTool(names[i + 1]!)) {
      const start = i
      while (i < names.length && isParallelSafeTool(names[i]!)) i++
      batches.push(names.slice(start, i))
      continue
    }
    batches.push([names[i]!])
    i++
  }
  assert.deepEqual(batches, [['read_file', 'grep', 'list_dir'], ['write_file'], ['read_file']])
})
