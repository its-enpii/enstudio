import type { ChatMessage, ChatResult, ToolCall, ToolDef } from './openai.js'

type RetryEvent = {
  attempt: number
  maxAttempts: number
  delayMs: number
  reason: string
}

type CircuitEvent = { state: 'open' | 'half_open' | 'closed'; model: string }

type ProviderError = Error & { status?: number; retryAfterMs?: number }
type Circuit = { failures: number; openedAt?: number; probing?: boolean }

const circuits = new Map<string, Circuit>()
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 30_000
const DEFAULT_MAX_TOKENS = 8192

export function resetAnthropicResilience(): void {
  circuits.clear()
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('aborted')
}

function retryable(error: unknown, signal?: AbortSignal): error is ProviderError {
  if (signal?.aborted) return false
  if (!(error instanceof Error)) return false
  const err = error as ProviderError
  if (typeof err.status === 'number') return RETRYABLE_STATUS.has(err.status)
  return err instanceof TypeError || /(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|temporary dns)/i.test(err.message)
}

function retryAfterMs(res: Response): number | undefined {
  const value = res.headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1_000, 30_000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 30_000)) : undefined
}

async function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

/** OpenAI ToolDef → Anthropic tool. */
export function toAnthropicTools(tools?: ToolDef[]): { name: string; description: string; input_schema: Record<string, unknown> }[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: 'object', properties: {} },
  }))
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicBlock[] }

/** Split system + convert OpenAI-style messages to Anthropic Messages API. */
export function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []

  const pushUser = (blocks: AnthropicBlock[]) => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last?.role === 'user' && Array.isArray(last.content)) {
      last.content.push(...blocks)
      return
    }
    out.push({ role: 'user', content: blocks })
  }

  for (const m of messages) {
    if (m.role === 'system') {
      const t = textOf(m.content)
      if (t) systemParts.push(t)
      continue
    }

    if (m.role === 'tool') {
      pushUser([
        {
          type: 'tool_result',
          tool_use_id: m.tool_call_id || 'unknown',
          content: textOf(m.content) || '',
        },
      ])
      continue
    }

    if (m.role === 'user') {
      const blocks: AnthropicBlock[] = []
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text' && part.text) blocks.push({ type: 'text', text: part.text })
          else if (part.type === 'image_url') {
            const url = part.image_url?.url ?? ''
            const match = /^data:([^;]+);base64,(.+)$/i.exec(url)
            if (match) {
              blocks.push({
                type: 'image',
                source: { type: 'base64', media_type: match[1]!, data: match[2]! },
              })
            } else if (url) {
              blocks.push({ type: 'text', text: `[image url omitted: ${url.slice(0, 120)}]` })
            }
          }
        }
      } else {
        const t = textOf(m.content)
        if (t) blocks.push({ type: 'text', text: t })
      }
      pushUser(blocks.length ? blocks : [{ type: 'text', text: '' }])
      continue
    }

    if (m.role === 'assistant') {
      const blocks: AnthropicBlock[] = []
      const t = textOf(m.content)
      if (t) blocks.push({ type: 'text', text: t })
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {}
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
        } catch {
          input = { _raw: tc.function.arguments }
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        })
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] })
    }
  }

  // Anthropic requires first message user; drop leading assistant empties
  while (out.length && out[0]!.role !== 'user') out.shift()
  // merge adjacent same-role
  const merged: AnthropicMessage[] = []
  for (const msg of out) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === msg.role) {
      const a = Array.isArray(prev.content) ? prev.content : [{ type: 'text' as const, text: String(prev.content) }]
      const b = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: String(msg.content) }]
      prev.content = [...a, ...b]
    } else {
      merged.push(msg)
    }
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: merged,
  }
}

function usageFromAnthropic(u?: { input_tokens?: number; output_tokens?: number }): ChatResult['usage'] | undefined {
  if (!u) return undefined
  const prompt = u.input_tokens ?? 0
  const completion = u.output_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  }
}

function parseNonStream(data: {
  content?: AnthropicBlock[]
  stop_reason?: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
  model?: string
}): ChatResult {
  let content = ''
  const tool_calls: ToolCall[] = []
  for (const block of data.content ?? []) {
    if (block.type === 'text') content += block.text
    else if (block.type === 'tool_use') {
      tool_calls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
        },
      })
    }
  }
  const finish =
    data.stop_reason === 'tool_use'
      ? 'tool_calls'
      : data.stop_reason === 'end_turn'
        ? 'stop'
        : data.stop_reason === 'max_tokens'
          ? 'length'
          : data.stop_reason ?? undefined
  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    finish_reason: finish,
    usage: usageFromAnthropic(data.usage),
    model: data.model,
  }
}

/** Anthropic Messages API (baseUrl already includes /v1). */
export async function anthropicMessages(opts: {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  stream?: boolean
  maxTokens?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onRetry?: (event: RetryEvent) => void
  onCircuit?: (event: CircuitEvent) => void
  resilience?: {
    maxAttempts?: number
    baseDelayMs?: number
    circuitFailureThreshold?: number
    circuitCooldownMs?: number
  }
}): Promise<ChatResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/messages`
  const key = `${url}\n${opts.model}`
  const maxAttempts = Math.max(1, Math.min(opts.resilience?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 5))
  const baseDelayMs = Math.max(0, opts.resilience?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS)
  const threshold = Math.max(1, opts.resilience?.circuitFailureThreshold ?? CIRCUIT_FAILURE_THRESHOLD)
  const cooldownMs = Math.max(0, opts.resilience?.circuitCooldownMs ?? CIRCUIT_COOLDOWN_MS)
  const circuit = circuits.get(key) ?? { failures: 0 }
  if (circuit.openedAt !== undefined) {
    if (Date.now() - circuit.openedAt < cooldownMs) {
      opts.onCircuit?.({ state: 'open', model: opts.model })
      throw new Error(`provider circuit open: ${opts.model}`)
    }
    if (circuit.probing) throw new Error(`provider circuit open: ${opts.model}`)
    circuit.probing = true
    opts.onCircuit?.({ state: 'half_open', model: opts.model })
  }

  const wantStream = opts.stream !== false && typeof opts.onDelta === 'function'
  // Stream+tools partial args messy; non-stream when tools present (same as OpenAI path).
  const stream = wantStream && !(opts.tools && opts.tools.length > 0)

  const converted = toAnthropicMessages(opts.messages)
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: converted.messages,
    stream,
  }
  if (converted.system) body.system = converted.system
  const tools = toAnthropicTools(opts.tools)
  if (tools?.length) body.tools = tools

  let res: Response | undefined
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': opts.apiKey,
            Authorization: `Bearer ${opts.apiKey}`,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: opts.signal,
        })
        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          const error = new Error(`provider ${res.status}: ${errBody.slice(0, 400) || res.statusText}`) as ProviderError
          error.status = res.status
          error.retryAfterMs = retryAfterMs(res)
          throw error
        }
        const recovered = circuit.openedAt !== undefined || circuit.probing
        circuit.failures = 0
        circuit.openedAt = undefined
        circuit.probing = false
        circuits.set(key, circuit)
        if (recovered) opts.onCircuit?.({ state: 'closed', model: opts.model })
        break
      } catch (error) {
        if (opts.signal?.aborted) throw abortError(opts.signal)
        if (!retryable(error, opts.signal) || attempt === maxAttempts) {
          if (retryable(error, opts.signal)) {
            circuit.failures++
            if (circuit.failures >= threshold) {
              circuit.openedAt = Date.now()
              opts.onCircuit?.({ state: 'open', model: opts.model })
            }
            circuit.probing = false
            circuits.set(key, circuit)
          }
          throw error
        }
        const providerError = error as ProviderError
        const delayMs =
          providerError.retryAfterMs ?? Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4))
        opts.onRetry?.({
          attempt,
          maxAttempts,
          delayMs,
          reason: error instanceof Error ? error.message : String(error),
        })
        await waitForRetry(delayMs, opts.signal)
      }
    }
  } catch (error) {
    circuit.probing = false
    throw error
  }

  if (!res) throw new Error('provider response missing')

  if (!stream) {
    const data = (await res.json()) as {
      content?: AnthropicBlock[]
      stop_reason?: string | null
      usage?: { input_tokens?: number; output_tokens?: number }
      model?: string
    }
    const parsed = parseNonStream(data)
    if (parsed.content && opts.onDelta) opts.onDelta(parsed.content)
    return parsed
  }

  if (!res.body) throw new Error('provider stream missing body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let usage: ChatResult['usage']
  let model: string | undefined
  let finish_reason: string | undefined
  const toolAcc = new Map<number, ToolCall>()
  let blockIndex = -1
  let currentBlockType: string | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    let eventName = ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        eventName = ''
        continue
      }
      if (trimmed.startsWith('event:')) {
        eventName = trimmed.slice(6).trim()
        continue
      }
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let json: Record<string, unknown>
      try {
        json = JSON.parse(data) as Record<string, unknown>
      } catch {
        continue
      }
      const type = (json.type as string) || eventName

      if (type === 'content_block_start') {
        blockIndex = typeof json.index === 'number' ? json.index : blockIndex + 1
        const block = json.content_block as { type?: string; id?: string; name?: string } | undefined
        currentBlockType = block?.type
        if (block?.type === 'tool_use') {
          toolAcc.set(blockIndex, {
            id: block.id ?? `call_${blockIndex}`,
            type: 'function',
            function: { name: block.name ?? '', arguments: '' },
          })
        }
      } else if (type === 'content_block_delta') {
        const delta = json.delta as { type?: string; text?: string; partial_json?: string } | undefined
        if (delta?.type === 'text_delta' && delta.text) {
          content += delta.text
          opts.onDelta?.(delta.text)
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          const cur = toolAcc.get(typeof json.index === 'number' ? json.index : blockIndex)
          if (cur) cur.function.arguments += delta.partial_json
        } else if (currentBlockType === 'text' && typeof delta?.text === 'string') {
          content += delta.text
          opts.onDelta?.(delta.text)
        }
      } else if (type === 'message_delta') {
        const delta = json.delta as { stop_reason?: string | null } | undefined
        const u = json.usage as { input_tokens?: number; output_tokens?: number } | undefined
        if (delta?.stop_reason) {
          finish_reason =
            delta.stop_reason === 'tool_use'
              ? 'tool_calls'
              : delta.stop_reason === 'end_turn'
                ? 'stop'
                : delta.stop_reason === 'max_tokens'
                  ? 'length'
                  : delta.stop_reason
        }
        if (u) usage = usageFromAnthropic(u)
      } else if (type === 'message_start') {
        const msg = json.message as { model?: string; usage?: { input_tokens?: number; output_tokens?: number } } | undefined
        if (msg?.model) model = msg.model
        if (msg?.usage) usage = usageFromAnthropic(msg.usage)
      }
    }
  }

  const tool_calls = toolAcc.size
    ? [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    : undefined

  return { content, tool_calls, finish_reason, usage, model }
}
