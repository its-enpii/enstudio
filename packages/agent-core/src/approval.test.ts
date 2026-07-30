import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveAllApprovals,
  resolveApproval,
  stopTurn,
  validateEditedArgs,
  type ApprovalResult,
  type SessionRuntime,
} from './loop.js'

function runtime(): SessionRuntime {
  return {
    meta: {
      id: 'approval-test',
      contractVersion: '0.1.0',
      projectRoot: process.cwd(),
      title: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'test',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'awaiting_approval',
    },
    messages: [],
    pendingApprovals: new Map(),
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

test('resolveApproval settles one of many pending waiters', async () => {
  const rt = runtime()
  const a = deferred<ApprovalResult>()
  const b = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('r1', { requestId: 'r1', resolve: a.resolve })
  rt.pendingApprovals!.set('r2', { requestId: 'r2', resolve: b.resolve })

  assert.equal(resolveApproval(rt, 'r1', 'allow'), true)
  assert.deepEqual(await a.promise, { decision: 'allow' })
  assert.equal(rt.pendingApprovals!.has('r1'), false)
  assert.equal(rt.pendingApprovals!.has('r2'), true)

  assert.equal(resolveApproval(rt, 'missing', 'deny'), false)
  assert.equal(resolveApproval(rt, 'r2', 'deny'), true)
  assert.deepEqual(await b.promise, { decision: 'deny' })
  assert.equal(rt.pendingApprovals!.size, 0)
})

test('resolveAllApprovals batch-settles every waiter', async () => {
  const rt = runtime()
  const waits = ['a', 'b', 'c'].map((id) => {
    const p = deferred<ApprovalResult>()
    rt.pendingApprovals!.set(id, { requestId: id, resolve: p.resolve })
    return p.promise
  })
  assert.equal(resolveAllApprovals(rt, 'allow'), 3)
  assert.deepEqual(await Promise.all(waits), [
    { decision: 'allow' },
    { decision: 'allow' },
    { decision: 'allow' },
  ])
  assert.equal(rt.pendingApprovals!.size, 0)
  assert.equal(resolveAllApprovals(rt, 'deny'), 0)
})

test('stopTurn denies all pending approvals', async () => {
  const rt = runtime()
  const p = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('x', { requestId: 'x', resolve: p.resolve })
  stopTurn(rt)
  assert.deepEqual(await p.promise, { decision: 'deny' })
  assert.equal(rt.pendingApprovals!.size, 0)
})

test('allow scope=session grants mutation kind', async () => {
  const rt = runtime()
  const p = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('w1', {
    requestId: 'w1',
    name: 'write_file',
    resolve: p.resolve,
  })
  assert.equal(resolveApproval(rt, 'w1', 'allow', 'session'), true)
  assert.deepEqual(await p.promise, { decision: 'allow' })
  assert.ok(rt.sessionGrants?.has('write'))
  assert.equal(rt.sessionGrants?.has('shell'), false)

  const shell = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('s1', {
    requestId: 's1',
    name: 'run_shell',
    resolve: shell.resolve,
  })
  assert.equal(resolveApproval(rt, 's1', 'allow', 'once'), true)
  assert.deepEqual(await shell.promise, { decision: 'allow' })
  assert.equal(rt.sessionGrants?.has('shell'), false)

  stopTurn(rt)
  // Session grants survive Stop — "Allow for session" must stick across turns.
  assert.ok(rt.sessionGrants?.has('write'))
})

test('allow scope=session auto-resolves other pending of same kind', async () => {
  const rt = runtime()
  const a = deferred<ApprovalResult>()
  const b = deferred<ApprovalResult>()
  const shell = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('e1', { requestId: 'e1', name: 'edit_file', resolve: a.resolve })
  rt.pendingApprovals!.set('e2', { requestId: 'e2', name: 'write_file', resolve: b.resolve })
  rt.pendingApprovals!.set('s1', { requestId: 's1', name: 'run_shell', resolve: shell.resolve })

  assert.equal(resolveApproval(rt, 'e1', 'allow', 'session'), true)
  assert.deepEqual(await Promise.all([a.promise, b.promise]), [
    { decision: 'allow' },
    { decision: 'allow' },
  ])
  assert.ok(rt.sessionGrants?.has('write'))
  assert.equal(rt.pendingApprovals!.has('e1'), false)
  assert.equal(rt.pendingApprovals!.has('e2'), false)
  // Shell still waiting — different kind (single-card session grant is kind-scoped)
  assert.equal(rt.pendingApprovals!.has('s1'), true)
  assert.equal(resolveApproval(rt, 'e2', 'allow', 'session'), false) // already settled
  assert.equal(resolveApproval(rt, 's1', 'deny'), true)
  assert.deepEqual(await shell.promise, { decision: 'deny' })
})

test('allow all for session grants every mutation kind', async () => {
  const rt = runtime()
  const w = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('e1', { requestId: 'e1', name: 'edit_file', resolve: w.resolve })
  assert.equal(resolveAllApprovals(rt, 'allow', 'session'), 1)
  assert.deepEqual(await w.promise, { decision: 'allow' })
  assert.ok(rt.sessionGrants?.has('write'))
  assert.ok(rt.sessionGrants?.has('shell'))
  assert.ok(rt.sessionGrants?.has('git'))
  assert.ok(rt.sessionGrants?.has('mcp'))
})

test('allow with editedArgs passes JSON through waiter', async () => {
  const rt = runtime()
  const p = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('e1', { requestId: 'e1', name: 'run_shell', resolve: p.resolve })
  const edited = JSON.stringify({ command: 'npm test' })
  assert.equal(resolveApproval(rt, 'e1', 'allow', 'once', { editedArgs: edited }), true)
  assert.deepEqual(await p.promise, { decision: 'allow', editedArgs: edited })
})

test('deny with reason reaches waiter', async () => {
  const rt = runtime()
  const p = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('e1', { requestId: 'e1', name: 'write_file', resolve: p.resolve })
  assert.equal(resolveApproval(rt, 'e1', 'deny', 'once', { reason: 'wrong path' }), true)
  assert.deepEqual(await p.promise, { decision: 'deny', reason: 'wrong path' })
})

test('bad editedArgs fail closed to deny', async () => {
  const rt = runtime()
  const p = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('e1', { requestId: 'e1', name: 'write_file', resolve: p.resolve })
  assert.equal(resolveApproval(rt, 'e1', 'allow', 'once', { editedArgs: 'not-json' }), true)
  const result = await p.promise
  assert.equal(result.decision, 'deny')
  assert.match(result.reason ?? '', /invalid JSON|editedArgs/i)
  assert.equal(result.editedArgs, undefined)
})

test('validateEditedArgs accepts object only', () => {
  assert.equal(validateEditedArgs(undefined), undefined)
  assert.equal(validateEditedArgs('{"a":1}'), undefined)
  assert.match(validateEditedArgs('[]') ?? '', /object/)
  assert.match(validateEditedArgs('"x"') ?? '', /object/)
  assert.match(validateEditedArgs('{') ?? '', /JSON/)
})

test('session allow keeps editedArgs only on clicked card', async () => {
  const rt = runtime()
  const a = deferred<ApprovalResult>()
  const b = deferred<ApprovalResult>()
  rt.pendingApprovals!.set('e1', { requestId: 'e1', name: 'edit_file', resolve: a.resolve })
  rt.pendingApprovals!.set('e2', { requestId: 'e2', name: 'write_file', resolve: b.resolve })
  const edited = JSON.stringify({ path: 'a.ts', content: 'x' })
  assert.equal(resolveApproval(rt, 'e1', 'allow', 'session', { editedArgs: edited }), true)
  assert.deepEqual(await a.promise, { decision: 'allow', editedArgs: edited })
  assert.deepEqual(await b.promise, { decision: 'allow' })
})
