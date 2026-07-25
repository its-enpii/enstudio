import { chatCompletions, type ChatMessage, type ToolCall } from './provider/openai.js'
import type { ProviderConfig } from './config.js'
import type { SessionMeta } from './types.js'
import { TOOL_DEFS, WRITE_TOOL_NAMES } from './tools/defs.js'
import { previewWriteTool, runTool } from './tools/run.js'

export interface SessionRuntime {
  meta: SessionMeta
  messages: ChatMessage[]
  abort?: AbortController
  /** Pending write approval waiter (session.approve resolves). */
  pendingApproval?: {
    requestId: string
    resolve: (decision: 'allow' | 'deny') => void
  }
}

export type LoopEmit = (event: {
  type: string
  sessionId: string
  [key: string]: unknown
}) => void

const MAX_ROUNDS = 8
const APPROVAL_TIMEOUT_MS = 5 * 60_000

const SYSTEM = `You are enpii, a local coding agent inside enpiistudio.
Workspace root is the user's open project. Be concise and practical.
Tools:
- Read: list_dir, read_file, glob, grep
- Write: write_file (create/overwrite), edit_file (unique substring replace)
Write tools may require user approval (ask mode). Prefer edit_file for small changes.
Use relative paths. Inspect with read tools before writing.
If a tool fails, explain and try another approach.`

type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

function addUsage(a?: Usage, b?: Usage): Usage | undefined {
  if (!a && !b) return undefined
  return {
    prompt_tokens: (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0),
    completion_tokens: (a?.completion_tokens ?? 0) + (b?.completion_tokens ?? 0),
    total_tokens: (a?.total_tokens ?? 0) + (b?.total_tokens ?? 0),
  }
}

function shortArgs(args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>
    return Object.entries(o)
      .map(([k, v]) => {
        if (k === 'content' || k === 'old_string' || k === 'new_string') {
          const s = String(v)
          return `${k}=${s.slice(0, 40)}${s.length > 40 ? '…' : ''}`
        }
        return `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`
      })
      .join(' ')
      .slice(0, 160)
  } catch {
    return args.slice(0, 160)
  }
}

function needsApproval(mode: SessionMeta['permissionMode'], name: string): boolean {
  if (!WRITE_TOOL_NAMES.has(name)) return false
  if (mode === 'read_only') return true // will deny later
  if (mode === 'ask') return true
  // autopilot_workspace + full: auto-allow workspace writes
  return false
}

export async function runPromptTurn(opts: {
  runtime: SessionRuntime
  text: string
  config: ProviderConfig
  emit: LoopEmit
  setStatus?: (status: SessionMeta['status']) => void
}): Promise<{ content: string; usage?: Usage }> {
  const { runtime, text, config, emit, setStatus } = opts
  const sessionId = runtime.meta.id
  const root = runtime.meta.projectRoot

  runtime.messages.push({ role: 'user', content: text })
  runtime.abort = new AbortController()

  emit({ type: 'status', sessionId, status: 'running', detail: `model ${config.model}` })
  setStatus?.('running')

  let usage: Usage | undefined
  let finalText = ''

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (runtime.abort.signal.aborted) throw new Error('stopped')

    const apiMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      ...runtime.messages,
    ]

    const result = await chatCompletions({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model || runtime.meta.model,
      messages: apiMessages,
      tools: TOOL_DEFS,
      stream: true,
      signal: runtime.abort.signal,
      onDelta: (delta) => {
        emit({ type: 'text_delta', sessionId, text: delta })
      },
    })

    usage = addUsage(usage, result.usage)
    const toolCalls = result.tool_calls?.filter((t) => t.function?.name) ?? []

    if (toolCalls.length > 0) {
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content || null,
        tool_calls: toolCalls,
      }
      runtime.messages.push(assistantMsg)

      if (result.content) {
        emit({
          type: 'assistant_message',
          sessionId,
          message: { role: 'assistant', content: result.content },
          partial: true,
        })
      }

      for (const tc of toolCalls) {
        await execOneTool({ root, sessionId, tc, runtime, emit, setStatus })
      }
      continue
    }

    finalText = result.content || ''
    runtime.messages.push({ role: 'assistant', content: finalText })
    emit({
      type: 'assistant_message',
      sessionId,
      message: { role: 'assistant', content: finalText },
      usage,
    })
    break
  }

  if (!finalText && !usage) {
    finalText = '(stopped after max tool rounds)'
    emit({
      type: 'assistant_message',
      sessionId,
      message: { role: 'assistant', content: finalText },
    })
  }

  if (usage) emit({ type: 'usage', sessionId, usage })
  setStatus?.('idle')
  emit({ type: 'status', sessionId, status: 'idle' })
  return { content: finalText, usage }
}

async function waitApproval(
  runtime: SessionRuntime,
  requestId: string,
): Promise<'allow' | 'deny'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (runtime.pendingApproval?.requestId === requestId) {
        runtime.pendingApproval = undefined
        resolve('deny')
      }
    }, APPROVAL_TIMEOUT_MS)

    runtime.pendingApproval = {
      requestId,
      resolve: (decision) => {
        clearTimeout(timer)
        runtime.pendingApproval = undefined
        resolve(decision)
      },
    }

    runtime.abort?.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        if (runtime.pendingApproval?.requestId === requestId) {
          runtime.pendingApproval = undefined
          resolve('deny')
        }
      },
      { once: true },
    )
  })
}

async function execOneTool(opts: {
  root: string
  sessionId: string
  tc: ToolCall
  runtime: SessionRuntime
  emit: LoopEmit
  setStatus?: (status: SessionMeta['status']) => void
}): Promise<void> {
  const { root, sessionId, tc, runtime, emit, setStatus } = opts
  const name = tc.function.name
  const args = tc.function.arguments || '{}'
  const mode = runtime.meta.permissionMode

  const startSummary =
    WRITE_TOOL_NAMES.has(name)
      ? previewWriteTool(root, name, args).summary
      : shortArgs(args)

  emit({
    type: 'tool_start',
    sessionId,
    toolCallId: tc.id,
    name,
    args: shortArgs(args),
    summary: startSummary,
  })

  // read_only blocks writes
  if (WRITE_TOOL_NAMES.has(name) && mode === 'read_only') {
    const msg = `write blocked: permissionMode=read_only`
    emit({
      type: 'tool_result',
      sessionId,
      toolCallId: tc.id,
      name,
      ok: false,
      summary: msg,
      preview: msg,
    })
    runtime.messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      name,
      content: msg,
    })
    return
  }

  if (needsApproval(mode, name)) {
    const requestId = tc.id
    const prev = previewWriteTool(root, name, args)
    setStatus?.('awaiting_approval')
    emit({
      type: 'approval_request',
      sessionId,
      requestId,
      toolCallId: tc.id,
      name,
      args: shortArgs(args),
      summary: prev.summary,
      preview: prev.preview,
    })
    emit({
      type: 'status',
      sessionId,
      status: 'awaiting_approval',
      detail: prev.summary,
    })

    const decision = await waitApproval(runtime, requestId)
    setStatus?.('running')
    emit({ type: 'status', sessionId, status: 'running' })

    if (decision !== 'allow') {
      const msg = 'user denied write'
      emit({
        type: 'tool_result',
        sessionId,
        toolCallId: tc.id,
        name,
        ok: false,
        summary: msg,
        preview: msg,
      })
      runtime.messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name,
        content: msg,
      })
      return
    }
  }

  const result = await runTool(root, name, args)

  emit({
    type: 'tool_result',
    sessionId,
    toolCallId: tc.id,
    name,
    ok: result.ok,
    summary: result.summary,
    preview: result.content.slice(0, 500),
  })

  if (result.ok && WRITE_TOOL_NAMES.has(name)) {
    emit({
      type: 'diff',
      sessionId,
      toolCallId: tc.id,
      name,
      summary: result.summary,
      preview: previewWriteTool(root, name, args).preview,
    })
  }

  runtime.messages.push({
    role: 'tool',
    tool_call_id: tc.id,
    name,
    content: result.content.slice(0, 80_000),
  })
}

export function resolveApproval(
  runtime: SessionRuntime,
  requestId: string,
  decision: 'allow' | 'deny',
): boolean {
  if (!runtime.pendingApproval || runtime.pendingApproval.requestId !== requestId) {
    return false
  }
  runtime.pendingApproval.resolve(decision)
  return true
}

export function stopTurn(runtime: SessionRuntime): void {
  if (runtime.pendingApproval) {
    runtime.pendingApproval.resolve('deny')
    runtime.pendingApproval = undefined
  }
  runtime.abort?.abort()
  runtime.abort = undefined
}
