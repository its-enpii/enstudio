import assert from 'node:assert/strict'
import test from 'node:test'
import { isMutatingTool, isParallelSafeTool, PARALLEL_SAFE_TOOL_NAMES } from './tools/defs.js'

test('parallel-safe tools are non-mutating', () => {
  for (const name of PARALLEL_SAFE_TOOL_NAMES) {
    assert.equal(isMutatingTool(name), false, name)
    assert.equal(isParallelSafeTool(name), true, name)
  }
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
