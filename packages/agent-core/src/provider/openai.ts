export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: ChatRole
  content: string | null
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
}): Promise<ChatResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const wantStream = opts.stream !== false && typeof opts.onDelta === 'function'
  // Some gateways mishandle stream+tools; prefer non-stream when tools present
  const stream = wantStream && !(opts.tools && opts.tools.length > 0)

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream,
  }
  if (opts.tools?.length) {
    body.tools = opts.tools
    body.tool_choice = 'auto'
  }

  const res = await fetch(url, {
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
    throw new Error(`provider ${res.status}: ${errBody.slice(0, 400) || res.statusText}`)
  }

  if (!stream) {
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null
          tool_calls?: ToolCall[]
        }
        finish_reason?: string
      }[]
      usage?: ChatResult['usage']
      model?: string
    }
    const msg = data.choices?.[0]?.message
    const content = msg?.content ?? ''
    if (content && opts.onDelta) opts.onDelta(content)
    return {
      content,
      tool_calls: msg?.tool_calls,
      finish_reason: data.choices?.[0]?.finish_reason,
      usage: data.usage,
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
      if (json.usage) usage = json.usage
      if (json.model) model = json.model
    }
  }

  const tool_calls = toolAcc.size
    ? [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    : undefined

  return { content, tool_calls, finish_reason, usage, model }
}
