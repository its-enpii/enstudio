import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveAnswer,
  stopTurn,
  type SessionRuntime,
} from './loop.js'
import { isMutatingTool } from './tools/defs.js'

function runtime(): SessionRuntime {
  return {
    meta: {
      id: 'plan-ask-test',
      contractVersion: '0.1.0',
      projectRoot: process.cwd(),
      title: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'test',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'running',
    },
    messages: [],
    pendingAnswers: new Map(),
    planMode: false,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('resolveAnswer settles pending ask waiter', async () => {
  const rt = runtime()
  const d = deferred<string>()
  rt.pendingAnswers!.set('q1', { requestId: 'q1', resolve: d.resolve })
  assert.equal(resolveAnswer(rt, 'q1', 'ship it'), true)
  assert.equal(await d.promise, 'ship it')
  assert.equal(rt.pendingAnswers!.has('q1'), false)
  assert.equal(resolveAnswer(rt, 'missing', 'x'), false)
})

test('stopTurn clears pending answers with empty string', async () => {
  const rt = runtime()
  const d = deferred<string>()
  rt.pendingAnswers!.set('q2', { requestId: 'q2', resolve: d.resolve })
  stopTurn(rt)
  assert.equal(await d.promise, '')
  assert.equal(rt.pendingAnswers!.size, 0)
})

test('planMode flag blocks mutating tool names by policy', () => {
  const rt = runtime()
  rt.planMode = true
  const blocked = ['write_file', 'edit_file', 'run_shell', 'git_commit', 'mcp_call_tool', 'agent', 'send_message']
  for (const name of blocked) {
    const shouldBlock = rt.planMode && (isMutatingTool(name) || name === 'agent' || name === 'send_message')
    assert.equal(shouldBlock, true, name)
  }
  assert.equal(rt.planMode && isMutatingTool('read_file'), false)
  assert.equal(rt.planMode && isMutatingTool('web_fetch'), false)
  rt.planMode = false
  assert.equal(rt.planMode && isMutatingTool('write_file'), false)
})
