import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  compactionTranscript,
  isCasualPrompt,
  repairChatMessages,
  repeatedReadOnlyToolCall,
  runDirectEdit,
  runPromptTurn,
  shouldAutoCompact,
  splitForCompaction,
  undoCompactRuntime,
  type SessionRuntime,
} from './loop.js'

test('duplicate read-only tool calls require new evidence', () => {
  const seen = new Set<string>()
  assert.equal(repeatedReadOnlyToolCall(seen, 'grep', '{"pattern":"token"}'), undefined)
  assert.match(
    repeatedReadOnlyToolCall(seen, 'grep', '{"pattern":"token"}') ?? '',
    /Skipped duplicate read-only tool call/,
  )
  assert.equal(repeatedReadOnlyToolCall(seen, 'grep', '{"pattern":"usage"}'), undefined)
  assert.equal(repeatedReadOnlyToolCall(seen, 'edit_file', '{"path":"a.ts"}'), undefined)
  assert.equal(repeatedReadOnlyToolCall(seen, 'grep', '{"pattern":"token"}'), undefined)
})

test('compaction transcript preserves roles and truncates older context', () => {
  const transcript = compactionTranscript([
    { role: 'user', content: 'goal' },
    { role: 'assistant', content: 'answer' },
  ], 20)
  assert.match(transcript, /\[assistant\]/)
  assert.match(transcript, /older context truncated/)
})

test('shouldAutoCompact thresholds', () => {
  assert.equal(shouldAutoCompact([{ role: 'user', content: 'hi' }]), false)
  // Mid-task tool chatter (36–89 msgs) must not force compact.
  const mid = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, content: `m${i}` }))
  assert.equal(shouldAutoCompact(mid), false)
  const many = Array.from({ length: 90 }, (_, i) => ({ role: 'user' as const, content: `m${i}` }))
  assert.equal(shouldAutoCompact(many), true)
  // Compact before context approaches the 250k-token ceiling.
  assert.equal(shouldAutoCompact([{ role: 'user', content: 'x' }], { total_tokens: 225_000 }), true)
  assert.equal(shouldAutoCompact([{ role: 'user', content: 'x' }], { total_tokens: 700_000 }), true)
  assert.equal(shouldAutoCompact([{ role: 'user', content: 'x' }], { total_tokens: 100 }), false)
})

test('splitForCompaction keeps recent tail raw', () => {
  const msgs = Array.from({ length: 12 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `m${i}`,
  }))
  const { toSummarize, keep } = splitForCompaction(msgs, 8)
  assert.equal(toSummarize.length, 4)
  assert.equal(keep.length, 8)
  assert.equal(keep[0]?.content, 'm4')
  assert.equal(keep[7]?.content, 'm11')
  const short = splitForCompaction(msgs.slice(0, 3), 8)
  assert.equal(short.toSummarize.length, 0)
  assert.equal(short.keep.length, 3)
})

test('splitForCompaction does not cut mid tool chain', () => {
  const msgs = [
    { role: 'user' as const, content: 'a' },
    { role: 'assistant' as const, content: null, tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'grep', arguments: '{}' } }] },
    { role: 'tool' as const, tool_call_id: 'c1', name: 'grep', content: 'ok' },
    { role: 'user' as const, content: 'b' },
  ]
  // keepRecent=2 would raw-cut at index 2 (tool) — must slide to assistant
  const { keep } = splitForCompaction(msgs, 2)
  assert.notEqual(keep[0]?.role, 'tool')
  assert.ok(keep.some((m) => m.role === 'assistant' && m.tool_calls?.length))
  assert.ok(keep.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'))
})

test('repairChatMessages drops orphan tools and fills missing results', () => {
  const fixed = repairChatMessages([
    { role: 'tool', tool_call_id: 'orphan', name: 'grep', content: 'x' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'grep', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', name: 'grep', content: 'hit' },
    // c2 missing
    { role: 'user', content: 'next' },
  ])
  assert.equal(fixed[0]?.role, 'assistant')
  assert.equal(fixed.filter((m) => m.role === 'tool').length, 2)
  assert.equal(fixed.find((m) => m.tool_call_id === 'c2')?.content?.toString().includes('unavailable'), true)
  assert.equal(fixed.some((m) => m.tool_call_id === 'orphan'), false)
  assert.equal(fixed.at(-1)?.role, 'user')
})

test('undoCompactRuntime restores pre-compact snapshot', () => {
  const runtime: SessionRuntime = {
    meta: {
      id: 'compact-undo',
      contractVersion: '0.1.0',
      projectRoot: process.cwd(),
      title: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'test',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'idle',
    },
    messages: [{ role: 'system', content: 'summary only' }],
    preCompactMessages: [
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'work' },
    ],
  }
  const out = undoCompactRuntime(runtime)
  assert.equal(out.messageCount, 2)
  assert.equal(runtime.messages[0]?.content, 'goal')
  assert.equal(runtime.preCompactMessages, undefined)
  assert.throws(() => undoCompactRuntime(runtime))
})

test('casual greetings do not need project tools', () => {
  assert.equal(isCasualPrompt('halo'), true)
  assert.equal(isCasualPrompt('Hello enpii!'), true)
  assert.equal(isCasualPrompt('cari string halo'), false)
})

test('casual greetings bypass the provider and tools', async () => {
  const runtime: SessionRuntime = {
    meta: {
      id: 'casual-test',
      contractVersion: '0.1.0',
      projectRoot: process.cwd(),
      title: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'test',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'idle',
    },
    messages: [],
  }
  const events: string[] = []
  const result = await runPromptTurn({
    runtime,
    text: 'hai',
    config: {
      baseUrl: 'http://127.0.0.1:1',
      apiKey: '',
      model: 'test',
      models: ['test'],
      dialect: 'openai',
      permissionMode: 'ask',
    },
    emit: (event) => events.push(event.type),
  })
  assert.equal(result.content, 'Hai. Ada yang bisa dibantu?')
  assert.equal(events.includes('tool_start'), false)
})

test('manual editor save bypasses agent approval in ask mode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-direct-edit-'))
  const file = path.join(root, 'example.txt')
  fs.writeFileSync(file, 'before\n', 'utf8')
  const runtime: SessionRuntime = {
    meta: {
      id: 'manual-edit-test',
      contractVersion: '0.1.0',
      projectRoot: root,
      title: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'test',
      dialect: 'openai',
      permissionMode: 'ask',
      status: 'idle',
    },
    messages: [],
  }
  const events: string[] = []
  try {
    const result = await runDirectEdit({
      runtime,
      path: 'example.txt',
      expectedContent: 'before\n',
      content: 'after\n',
      emit: (event) => events.push(event.type),
    })
    assert.equal(result.ok, true)
    assert.equal(fs.readFileSync(file, 'utf8'), 'after\n')
    assert.equal(events.includes('approval_request'), false)
    assert.equal(runtime.messages.length, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
