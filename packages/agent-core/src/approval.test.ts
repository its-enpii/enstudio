import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveAllApprovals,
  resolveApproval,
  stopTurn,
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
  const a = deferred<'allow' | 'deny'>()
  const b = deferred<'allow' | 'deny'>()
  rt.pendingApprovals!.set('r1', { requestId: 'r1', resolve: a.resolve })
  rt.pendingApprovals!.set('r2', { requestId: 'r2', resolve: b.resolve })

  assert.equal(resolveApproval(rt, 'r1', 'allow'), true)
  assert.equal(await a.promise, 'allow')
  assert.equal(rt.pendingApprovals!.has('r1'), false)
  assert.equal(rt.pendingApprovals!.has('r2'), true)

  assert.equal(resolveApproval(rt, 'missing', 'deny'), false)
  assert.equal(resolveApproval(rt, 'r2', 'deny'), true)
  assert.equal(await b.promise, 'deny')
  assert.equal(rt.pendingApprovals!.size, 0)
})

test('resolveAllApprovals batch-settles every waiter', async () => {
  const rt = runtime()
  const waits = ['a', 'b', 'c'].map((id) => {
    const p = deferred<'allow' | 'deny'>()
    rt.pendingApprovals!.set(id, { requestId: id, resolve: p.resolve })
    return p.promise
  })
  assert.equal(resolveAllApprovals(rt, 'allow'), 3)
  assert.deepEqual(await Promise.all(waits), ['allow', 'allow', 'allow'])
  assert.equal(rt.pendingApprovals!.size, 0)
  assert.equal(resolveAllApprovals(rt, 'deny'), 0)
})

test('stopTurn denies all pending approvals', async () => {
  const rt = runtime()
  const p = deferred<'allow' | 'deny'>()
  rt.pendingApprovals!.set('x', { requestId: 'x', resolve: p.resolve })
  stopTurn(rt)
  assert.equal(await p.promise, 'deny')
  assert.equal(rt.pendingApprovals!.size, 0)
})

test('allow scope=session grants mutation kind', async () => {
  const rt = runtime()
  const p = deferred<'allow' | 'deny'>()
  rt.pendingApprovals!.set('w1', {
    requestId: 'w1',
    name: 'write_file',
    resolve: p.resolve,
  })
  assert.equal(resolveApproval(rt, 'w1', 'allow', 'session'), true)
  assert.equal(await p.promise, 'allow')
  assert.ok(rt.sessionGrants?.has('write'))
  assert.equal(rt.sessionGrants?.has('shell'), false)

  const shell = deferred<'allow' | 'deny'>()
  rt.pendingApprovals!.set('s1', {
    requestId: 's1',
    name: 'run_shell',
    resolve: shell.resolve,
  })
  assert.equal(resolveApproval(rt, 's1', 'allow', 'once'), true)
  assert.equal(await shell.promise, 'allow')
  assert.equal(rt.sessionGrants?.has('shell'), false)

  stopTurn(rt)
  assert.equal(rt.sessionGrants?.size ?? 0, 0)
})
