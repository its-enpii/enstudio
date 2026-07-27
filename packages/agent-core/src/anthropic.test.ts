import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anthropicMessages,
  resetAnthropicResilience,
  toAnthropicMessages,
  toAnthropicTools,
} from './provider/anthropic.js'
import { providerChat } from './provider/chat.js'
import type { ToolDef } from './provider/openai.js'

test.beforeEach(() => {
  resetAnthropicResilience()
})

test('toAnthropicMessages lifts system + maps tool_result', () => {
  const { system, messages } = toAnthropicMessages([
    { role: 'system', content: 'sys-a' },
    { role: 'system', content: 'sys-b' },
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'file body' },
  ])
  assert.equal(system, 'sys-a\n\nsys-b')
  assert.equal(messages[0]?.role, 'user')
  assert.equal(messages[1]?.role, 'assistant')
  const toolResult = messages[2]
  assert.equal(toolResult?.role, 'user')
  assert.ok(Array.isArray(toolResult?.content))
  const blocks = toolResult!.content as { type: string; tool_use_id?: string }[]
  assert.equal(blocks[0]?.type, 'tool_result')
  assert.equal(blocks[0]?.tool_use_id, 'c1')
})

test('toAnthropicTools maps OpenAI function schema', () => {
  const tools: ToolDef[] = [
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'list',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    },
  ]
  const mapped = toAnthropicTools(tools)!
  assert.equal(mapped[0]!.name, 'list_dir')
  assert.equal(mapped[0]!.input_schema.type, 'object')
})

test('anthropicMessages posts /messages with x-api-key', async () => {
  const original = globalThis.fetch
  let url = ''
  let headers: Record<string, string> = {}
  let body: Record<string, unknown> = {}
  globalThis.fetch = (async (input, init) => {
    url = String(input)
    headers = Object.fromEntries(new Headers(init?.headers).entries())
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        content: [
          { type: 'text', text: 'hello ' },
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'list_dir',
            input: { path: '.' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-test',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const result = await anthropicMessages({
      baseUrl: 'https://api.test/v1',
      apiKey: 'sk-ant',
      model: 'claude-test',
      stream: false,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'list root' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'list_dir',
            description: 'list',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    })
    assert.equal(url, 'https://api.test/v1/messages')
    assert.equal(headers['x-api-key'], 'sk-ant')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    assert.equal(body.model, 'claude-test')
    assert.equal(body.system, 'be brief')
    assert.ok(Array.isArray(body.tools))
    assert.equal(result.content, 'hello ')
    assert.equal(result.finish_reason, 'tool_calls')
    assert.equal(result.tool_calls?.[0]?.function.name, 'list_dir')
    assert.equal(result.usage?.prompt_tokens, 10)
    assert.equal(result.usage?.completion_tokens, 5)
  } finally {
    globalThis.fetch = original
  }
})

test('providerChat routes anthropic dialect', async () => {
  const original = globalThis.fetch
  let hit = ''
  globalThis.fetch = (async (input) => {
    hit = String(input)
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'via-ant' }], stop_reason: 'end_turn' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const result = await providerChat({
      dialect: 'anthropic',
      baseUrl: 'https://api.test/v1',
      apiKey: 'k',
      model: 'm',
      stream: false,
      messages: [{ role: 'user', content: 'hi' }],
    })
    assert.match(hit, /\/messages$/)
    assert.equal(result.content, 'via-ant')
  } finally {
    globalThis.fetch = original
  }
})
