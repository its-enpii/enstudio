import { normalizeUsage } from '../usage.js'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ChatResult {
  content: string
  tool_calls?: ToolCall[]
  finish_reason?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    /** Cache hits (subset of prompt), when provider/gateway reports. */
    cached_tokens?: number
  }
  model?: string
}

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

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

export function resetProviderResilience(): void {
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

/** OpenAI-compatible Chat Completions (baseUrl already includes /v1). */
export async function chatCompletions(opts: {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  stream?: boolean
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
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`
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
  // Some gateways mishandle stream+tools; prefer non-stream when tools present
  const stream = wantStream && !(opts.tools && opts.tools.length > 0)

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream,
  }
  // Without this, many OpenAI-compat streams omit the final usage chunk → UI undercounts.
  if (stream) body.stream_options = { include_usage: true }
  if (opts.tools?.length) {
    body.tools = opts.tools
    body.tool_choice = 'auto'
  }

  let res: Response | undefined
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
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
        const delayMs = providerError.retryAfterMs ?? Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4))
        opts.onRetry?.({ attempt, maxAttempts, delayMs, reason: error instanceof Error ? error.message : String(error) })
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
      choices?: {
        message?: {
          content?: string | null
          tool_calls?: ToolCall[]
        }
        finish_reason?: string
      }[]
      usage?: unknown
      model?: string
    }
    const msg = data.choices?.[0]?.message
    const content = msg?.content ?? ''
    if (content && opts.onDelta) opts.onDelta(content)
    return {
      content,
      tool_calls: msg?.tool_calls,
      finish_reason: data.choices?.[0]?.finish_reason,
      usage: normalizeUsage(data.usage),
      model: data.model,
    }
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

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let json: {
        choices?: {
          delta?: {
            content?: string
            tool_calls?: {
              index?: number
              id?: string
              type?: string
              function?: { name?: string; arguments?: string }
            }[]
          }
          finish_reason?: string | null
        }[]
        usage?: ChatResult['usage']
        model?: string
      }
      try {
        json = JSON.parse(data) as typeof json
      } catch {
        continue
      }
      const choice = json.choices?.[0]
      const delta = choice?.delta?.content
      if (delta) {
        content += delta
        opts.onDelta?.(delta)
      }
      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0
          const cur = toolAcc.get(idx) ?? {
            id: tc.id ?? `call_${idx}`,
            type: 'function' as const,
            function: { name: '', arguments: '' },
          }
          if (tc.id) cur.id = tc.id
          if (tc.function?.name) cur.function.name += tc.function.name
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
          toolAcc.set(idx, cur)
        }
      }
      if (choice?.finish_reason) finish_reason = choice.finish_reason
      if (json.usage) usage = normalizeUsage(json.usage) ?? usage
      if (json.model) model = json.model
    }
  }

  const tool_calls = toolAcc.size
    ? [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    : undefined

  return { content, tool_calls, finish_reason, usage, model }
}
