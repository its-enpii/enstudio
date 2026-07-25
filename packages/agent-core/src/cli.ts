import { StdioJsonRpcServer } from './rpc.js'
import { SessionStore } from './session.js'
import { loadProviderConfig, assertProviderReady } from './config.js'
import {
  resolveApproval,
  runPromptTurn,
  stopTurn,
  type SessionRuntime,
} from './loop.js'
import type { HealthResult } from './types.js'
import type { ChatMessage } from './provider/openai.js'

const VERSION = '0.1.0'

function shortToolSummary(name: string, args: string): string {
  try {
    const o = JSON.parse(args || '{}') as Record<string, unknown>
    const bits = Object.entries(o)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ')
    return `${name}${bits ? ` ${bits}` : ''}`.slice(0, 120)
  } catch {
    return `${name} ${args}`.slice(0, 120)
  }
}

/** UI timeline rows — one card per tool *result* (not tool_call + result). */
function toolResultOk(content: string): boolean {
  const c = content.toLowerCase()
  if (c.startsWith('user denied')) return false
  if (c.includes('write blocked')) return false
  if (c.startsWith('invalid tool')) return false
  if (c.startsWith('unknown tool')) return false
  if (c.startsWith('not a file') || c.startsWith('not a directory')) return false
  if (c.startsWith('path outside')) return false
  if (c.startsWith('old_string ')) return false
  if (c.startsWith('path required') || c.startsWith('pattern required')) return false
  if (c.startsWith('content too large') || c.startsWith('result too large')) return false
  if (c.startsWith('binary file')) return false
  if (c.startsWith('bad regex')) return false
  return true
}

function uiMessagesFromRuntime(messages: ChatMessage[]): {
  role: string
  content: string
  toolName?: string
  summary?: string
  preview?: string
  ok?: boolean
}[] {
  const out: {
    role: string
    content: string
    toolName?: string
    summary?: string
    preview?: string
    ok?: boolean
  }[] = []

  // index tool_calls by id for summary labels
  const callMeta = new Map<string, { name: string; args: string }>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        callMeta.set(tc.id, {
          name: tc.function.name,
          args: tc.function.arguments || '{}',
        })
      }
    }
  }

  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user' && typeof m.content === 'string') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content })
      // tool_calls themselves are not UI rows — wait for tool results
      continue
    }
    if (m.role === 'tool') {
      const meta = m.tool_call_id ? callMeta.get(m.tool_call_id) : undefined
      const name = m.name || meta?.name || 'tool'
      const summary = meta
        ? shortToolSummary(meta.name, meta.args)
        : name
      const preview =
        typeof m.content === 'string' ? m.content.slice(0, 500) : ''
      const ok = toolResultOk(typeof m.content === 'string' ? m.content : '')
      out.push({
        role: 'tool',
        content: summary,
        toolName: name,
        summary,
        preview,
        ok,
      })
    }
  }
  return out
}

async function main(): Promise<void> {
  const sessions = new SessionStore()
  const runtimes = new Map<string, SessionRuntime>()
  const rpc = new StdioJsonRpcServer()
  const provider = loadProviderConfig()

  function getRuntime(sessionId: string): SessionRuntime | undefined {
    const meta = sessions.get(sessionId)
    if (!meta) return undefined
    const messages = sessions.getMessages(sessionId)
    const existing = runtimes.get(sessionId)
    if (existing) {
      existing.meta = meta
      // Prefer longer transcript (disk may be newer after restart)
      if (messages.length >= existing.messages.length) {
        existing.messages = messages
      }
      return existing
    }
    const runtime: SessionRuntime = { meta, messages }
    runtimes.set(sessionId, runtime)
    return runtime
  }

  rpc.on('health', (): HealthResult => ({
    ok: true,
    name: 'enpii',
    version: VERSION,
    contractVersion: '0.1.0',
    pid: process.pid,
  }))

  rpc.on('config.get', () => ({
    baseUrl: provider.baseUrl,
    model: provider.model,
    dialect: provider.dialect,
    hasKey: Boolean(provider.apiKey),
  }))

  rpc.on('session.upsert', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      sessionId?: string
      title?: string
      permissionMode?: 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
      model?: string
      dialect?: 'anthropic' | 'openai'
      fresh?: boolean
    }
    if (!p.projectRoot || typeof p.projectRoot !== 'string') {
      throw new Error('projectRoot is required')
    }

    const meta = p.fresh
      ? sessions.create({
          projectRoot: p.projectRoot,
          title: p.title,
          permissionMode: p.permissionMode,
          model: p.model ?? provider.model,
          dialect: p.dialect ?? provider.dialect,
        })
      : sessions.upsert({
          projectRoot: p.projectRoot,
          sessionId: p.sessionId,
          title: p.title,
          permissionMode: p.permissionMode,
          model: p.model ?? provider.model,
          dialect: p.dialect ?? provider.dialect,
        })

    const runtime = getRuntime(meta.id)!
    runtime.meta = meta
    return {
      ...meta,
      messageCount: runtime.messages.length,
    }
  })

  rpc.on('session.get', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const loaded = sessions.loadPersisted(p.sessionId)
    if (!loaded) throw new Error(`session not found: ${p.sessionId}`)
    const runtime = getRuntime(p.sessionId)
    if (runtime) {
      runtime.meta = loaded.meta
      runtime.messages = loaded.messages
    }
    return {
      meta: loaded.meta,
      messages: uiMessagesFromRuntime(loaded.messages),
    }
  })

  rpc.on('session.list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    return sessions.list(p.projectRoot)
  })

  rpc.on('session.prompt', async (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string; text?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    if (!p.text?.trim()) throw new Error('text is required')

    assertProviderReady(provider)

    const runtime = getRuntime(p.sessionId)!
    runtime.meta = meta

    try {
      sessions.setStatus(p.sessionId, 'running')
      const result = await runPromptTurn({
        runtime,
        text: p.text,
        config: provider,
        emit: (event) => rpc.notify('event', event),
        setStatus: (status) => sessions.setStatus(p.sessionId!, status),
      })
      sessions.setMessages(p.sessionId, runtime.messages)
      sessions.setStatus(p.sessionId, 'idle')
      return { ok: true, content: result.content, usage: result.usage }
    } catch (err) {
      sessions.setMessages(p.sessionId, runtime.messages)
      sessions.setStatus(p.sessionId, 'error')
      const message = err instanceof Error ? err.message : String(err)
      rpc.notify('event', {
        type: 'error',
        sessionId: p.sessionId,
        message,
      })
      rpc.notify('event', {
        type: 'status',
        sessionId: p.sessionId,
        status: 'error',
        detail: message,
      })
      throw err
    }
  })

  rpc.on('session.approve', (_method, params) => {
    const p = (params ?? {}) as {
      sessionId?: string
      requestId?: string
      decision?: 'allow' | 'deny'
    }
    if (!p.sessionId) throw new Error('sessionId is required')
    if (!p.requestId) throw new Error('requestId is required')
    if (p.decision !== 'allow' && p.decision !== 'deny') {
      throw new Error('decision must be allow|deny')
    }
    const runtime = runtimes.get(p.sessionId)
    if (!runtime) throw new Error(`session not running: ${p.sessionId}`)
    const ok = resolveApproval(runtime, p.requestId, p.decision)
    if (!ok) throw new Error(`no pending approval: ${p.requestId}`)
    return { ok: true, decision: p.decision }
  })

  rpc.on('session.stop', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const runtime = runtimes.get(p.sessionId)
    if (runtime) {
      stopTurn(runtime)
      sessions.setMessages(p.sessionId, runtime.messages)
    }
    sessions.setStatus(p.sessionId, 'idle')
    rpc.notify('event', {
      type: 'status',
      sessionId: p.sessionId,
      status: 'idle',
      detail: 'stopped',
    })
    return { ok: true }
  })

  console.error(
    `[enpii] sidecar ready pid=${process.pid} v${VERSION} model=${provider.model} base=${provider.baseUrl} key=${provider.apiKey ? 'yes' : 'no'}`,
  )
  rpc.start()
}

main().catch((err) => {
  console.error('[enpii] fatal', err)
  process.exit(1)
})
