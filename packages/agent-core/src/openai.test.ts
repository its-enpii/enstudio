import assert from 'node:assert/strict'
import test from 'node:test'
import { chatCompletions, resetProviderResilience } from './provider/openai.js'

const base = {
  baseUrl: 'https://provider.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'hello' }],
  stream: false,
  resilience: { baseDelayMs: 0 },
}

function okResponse(content = 'ok'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, retryAfter?: string): Response {
  return new Response('temporary', {
    status,
    headers: retryAfter ? { 'retry-after': retryAfter } : undefined,
  })
}

test.beforeEach(() => {
  resetProviderResilience()
})

test('sends multimodal user content unchanged', async () => {
  const original = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return okResponse()
  }) as typeof fetch
  try {
    await chatCompletions({
      ...base,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'inspect' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }],
    })
    assert.match(JSON.stringify(requestBody?.messages), /image_url/)
    assert.match(JSON.stringify(requestBody?.messages), /data:image\/png;base64/)
  } finally {
    globalThis.fetch = original
  }
})

test('streams responses when tools are present', async () => {
  const original = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch
  try {
    const result = await chatCompletions({
      ...base,
      stream: true,
      onDelta: () => {},
      tools: [{ type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object' } } }],
    })
    assert.equal(requestBody?.stream, true)
    assert.equal(result.tool_calls?.[0]?.function.name, 'read_file')
    assert.equal(result.tool_calls?.[0]?.function.arguments, '{"path":"a.ts"}')
  } finally {
    globalThis.fetch = original
  }
})

test('retries transient provider failure and succeeds', async () => {
  const original = globalThis.fetch
  let calls = 0
  const retries: number[] = []
  globalThis.fetch = (async () => {
    calls++
    return calls === 1 ? errorResponse(503) : okResponse('recovered')
  }) as typeof fetch
  try {
    const result = await chatCompletions({
      ...base,
      onRetry: (event) => retries.push(event.attempt),
    })
    assert.equal(result.content, 'recovered')
    assert.equal(calls, 2)
    assert.deepEqual(retries, [1])
  } finally {
    globalThis.fetch = original
  }
})

test('does not retry authentication failures', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return errorResponse(401)
  }) as typeof fetch
  try {
    await assert.rejects(() => chatCompletions(base), /provider 401/)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('abort stops retry backoff', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return errorResponse(503)
  }) as typeof fetch
  try {
    const pending = chatCompletions({
      ...base,
      signal: controller.signal,
      resilience: { baseDelayMs: 10_000 },
    })
    setTimeout(() => controller.abort(), 5)
    await assert.rejects(pending, /aborted|AbortError/i)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('opens circuit after repeated transient failures', async () => {
  const original = globalThis.fetch
  let calls = 0
  const states: string[] = []
  globalThis.fetch = (async () => {
    calls++
    return errorResponse(503)
  }) as typeof fetch
  try {
    for (let index = 0; index < 3; index++) {
      await assert.rejects(() => chatCompletions({
        ...base,
        resilience: { maxAttempts: 1, circuitFailureThreshold: 3 },
        onCircuit: (event) => states.push(event.state),
      }), /provider 503/)
    }
    await assert.rejects(() => chatCompletions({
      ...base,
      resilience: { maxAttempts: 1 },
      onCircuit: (event) => states.push(event.state),
    }), /provider circuit open/)
    assert.equal(calls, 3)
    assert.deepEqual(states, ['open', 'open'])
  } finally {
    globalThis.fetch = original
  }
})

test('does not retry malformed successful response', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response('{broken', { status: 200 })
  }) as typeof fetch
  try {
    await assert.rejects(() => chatCompletions(base), /JSON|Unexpected/i)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('honors retry-after header', async () => {
  const original = globalThis.fetch
  let calls = 0
  let retryDelay = -1
  globalThis.fetch = (async () => {
    calls++
    return calls === 1 ? errorResponse(429, '0') : okResponse()
  }) as typeof fetch
  try {
    await chatCompletions({
      ...base,
      onRetry: (event) => { retryDelay = event.delayMs },
    })
    assert.equal(retryDelay, 0)
  } finally {
    globalThis.fetch = original
  }
})
