import { state, type ChatMessage } from './store.svelte'

export async function respondApproval(decision: 'allow' | 'deny'): Promise<void> {
  const a = state.approval
  if (!a) return
  try {
    await window.enpiistudio.enpii.request('session.approve', {
      sessionId: a.sessionId,
      requestId: a.requestId,
      decision,
    })
    state.pushLog(`[approval] ${decision} ${a.name}`)
  } catch (err) {
    state.pushLog(
      `[approval] failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    state.clearApproval()
  }
}

export async function pingEnpii(): Promise<void> {
  try {
    const res = (await window.enpiistudio.enpii.request('health')) as {
      ok: boolean
      name: string
      version: string
      pid: number
    }
    state.enpiiStatus = res.ok ? 'ok' : 'error'
    state.enpiiInfo = `${res.name} v${res.version} · pid ${res.pid}`

    try {
      const cfg = (await window.enpiistudio.enpii.request('config.get')) as {
        model?: string
        baseUrl?: string
        hasKey?: boolean
      }
      state.enpiiInfo += ` · ${cfg.model ?? '?'} · key ${cfg.hasKey ? 'ok' : 'missing'}`
    } catch {
      /* older sidecar */
    }
  } catch (err) {
    state.enpiiStatus = 'error'
    state.enpiiInfo = err instanceof Error ? err.message : String(err)
  }
}

function mapDiskMessages(
  rows: {
    role: string
    content: string
    toolName?: string
    summary?: string
    preview?: string
    ok?: boolean
  }[],
): ChatMessage[] {
  return rows.map((r) => {
    if (r.role === 'tool') {
      const summary = r.summary ?? r.content.slice(0, 120)
      const ok = r.ok !== false
      return {
        id: crypto.randomUUID(),
        role: 'tool' as const,
        text: summary,
        ts: Date.now(),
        tool: {
          callId: crypto.randomUUID(),
          name: r.toolName ?? 'tool',
          status: ok ? ('ok' as const) : ('error' as const),
          summary,
          preview: r.preview ?? r.content.slice(0, 500),
        },
      }
    }
    return {
      id: crypto.randomUUID(),
      role: (r.role === 'user' || r.role === 'assistant' || r.role === 'system'
        ? r.role
        : 'assistant') as ChatMessage['role'],
      text: r.content,
      ts: Date.now(),
    }
  })
}

export async function refreshSessionList(): Promise<void> {
  const project = state.activeProject
  if (!project) {
    state.sessionList = []
    return
  }
  try {
    const list = (await window.enpiistudio.enpii.request('session.list', {
      projectRoot: project.path,
    })) as { id: string; title: string; status: string; model: string; updatedAt?: string }[]
    state.sessionList = list.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      model: s.model,
    }))
  } catch {
    state.sessionList = state.session ? [state.session] : []
  }
}

/** Resume latest disk session for active project (or keep memory if already loaded). */
export async function hydrateProjectSession(): Promise<void> {
  const project = state.activeProject
  if (!project) return

  // Memory cache already has chat for this project — still refresh list
  if (state.messages.length > 0 && state.session) {
    await refreshSessionList()
    return
  }

  try {
    const meta = (await window.enpiistudio.enpii.request('session.upsert', {
      projectRoot: project.path,
      title: `${project.name} session`,
      model: 'enpii',
      dialect: 'openai',
    })) as {
      id: string
      title: string
      status: string
      model: string
      messageCount?: number
    }

    state.session = {
      id: meta.id,
      title: meta.title,
      status: meta.status,
      model: meta.model,
    }

    // Always try session.get — messageCount can be wrong if runtime not synced
    const loaded = (await window.enpiistudio.enpii.request('session.get', {
      sessionId: meta.id,
    })) as {
      meta: { id: string; title: string; status: string; model: string }
      messages: { role: string; content: string; toolName?: string }[]
    }
    state.messages = mapDiskMessages(loaded.messages ?? [])
    state.session = {
      id: loaded.meta.id,
      title: loaded.meta.title,
      status: loaded.meta.status,
      model: loaded.meta.model,
    }
    state.pushLog(
      `[session] hydrate ${loaded.meta.id.slice(0, 8)}… msgs=${loaded.messages?.length ?? 0}`,
    )

    await refreshSessionList()
  } catch (err) {
    state.pushLog(
      `[session] hydrate failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export async function ensureSession(): Promise<string | null> {
  const project = state.activeProject
  if (!project) return null

  if (state.session) return state.session.id

  await hydrateProjectSession()
  return state.session?.id ?? null
}

export async function newSession(): Promise<void> {
  const project = state.activeProject
  if (!project) return

  const meta = (await window.enpiistudio.enpii.request('session.upsert', {
    projectRoot: project.path,
    title: `${project.name} session`,
    model: 'enpii',
    dialect: 'openai',
    fresh: true,
  })) as { id: string; title: string; status: string; model: string }

  state.session = {
    id: meta.id,
    title: meta.title,
    status: meta.status,
    model: meta.model,
  }
  state.messages = []
  state.usage = null
  state.streamingId = null
  state.approval = null
  state.diffs = []
  await refreshSessionList()
}

export async function openSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  if (state.busy) {
    state.pushLog('[session] cannot switch while agent busy')
    return
  }
  if (state.session?.id === sessionId && state.messages.length > 0) {
    return
  }
  try {
    state.pushLog(`[session] open ${sessionId.slice(0, 8)}…`)
    const loaded = (await window.enpiistudio.enpii.request('session.get', {
      sessionId,
    })) as {
      meta: { id: string; title: string; status: string; model: string }
      messages: { role: string; content: string; toolName?: string }[]
    }
    state.session = {
      id: loaded.meta.id,
      title: loaded.meta.title,
      status: loaded.meta.status,
      model: loaded.meta.model,
    }
    state.messages = mapDiskMessages(loaded.messages ?? [])
    state.streamingId = null
    state.usage = null
    state.approval = null
    state.pushLog(`[session] loaded msgs=${state.messages.length}`)
    await refreshSessionList()
  } catch (err) {
    state.pushLog(
      `[session] open failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export async function sendPrompt(text: string): Promise<void> {
  const sessionId = await ensureSession()
  if (!sessionId) throw new Error('Open a project first')

  state.pushMessage({ role: 'user', text })
  state.busy = true
  state.streamingId = null
  try {
    await window.enpiistudio.enpii.request('session.prompt', {
      sessionId,
      text,
    })
    await refreshSessionList()
  } finally {
    state.busy = false
  }
}

export function bindEnpiiEvents(): () => void {
  const api = window.enpiistudio
  if (!api?.enpii) {
    state.enpiiStatus = 'error'
    state.enpiiInfo = 'preload missing (window.enpiistudio undefined)'
    state.pushLog('[preload] window.enpiistudio undefined — check dist-electron/preload.cjs')
    return () => {}
  }

  const offEvent = api.enpii.onEvent((payload) => {
    const msg = payload as {
      method?: string
      params?: {
        type?: string
        sessionId?: string
        status?: string
        text?: string
        message?: { role?: string; content?: string }
        detail?: string
        partial?: boolean
        toolCallId?: string
        requestId?: string
        name?: string
        args?: string
        ok?: boolean
        summary?: string
        preview?: string
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
      }
    }
    const p = msg.params
    if (!p) return

    if (p.type === 'text_delta' && p.text) {
      if (state.streamingId) {
        state.appendToMessage(state.streamingId, p.text)
      } else {
        const m = state.pushMessage({ role: 'assistant', text: p.text })
        state.streamingId = m.id
      }
      return
    }

    if (p.type === 'tool_start' && p.toolCallId && p.name) {
      state.streamingId = null
      state.pushMessage({
        role: 'tool',
        text: p.summary ?? p.name,
        tool: {
          callId: p.toolCallId,
          name: p.name,
          args: p.args,
          status: 'running',
          summary: p.summary ?? `${p.name} ${p.args ?? ''}`.trim(),
        },
      })
      return
    }

    if (p.type === 'approval_request' && p.requestId && p.name) {
      state.approval = {
        requestId: p.requestId,
        sessionId: p.sessionId ?? state.session?.id ?? '',
        toolCallId: p.toolCallId ?? p.requestId,
        name: p.name,
        summary: p.summary ?? p.name,
        preview: p.preview ?? '',
        args: p.args,
      }
      return
    }

    if (p.type === 'tool_result' && p.toolCallId) {
      state.updateTool(p.toolCallId, {
        status: p.ok === false ? 'error' : 'ok',
        summary: p.summary,
        preview: p.preview,
        text: p.summary ?? p.name ?? 'tool',
      })
      return
    }

    if (p.type === 'diff' && p.summary) {
      state.pushDiff({
        name: p.name ?? 'write',
        summary: p.summary,
        preview: p.preview ?? '',
      })
      return
    }

    if (p.type === 'assistant_message' && p.message?.content) {
      const content =
        typeof p.message.content === 'string'
          ? p.message.content
          : JSON.stringify(p.message.content)
      const id =
        state.streamingId ??
        [...state.messages].reverse().find((m) => m.role === 'assistant')?.id
      if (id) {
        state.messages = state.messages.map((m) =>
          m.id === id ? { ...m, text: content } : m,
        )
        state.streamingId = null
      } else {
        state.pushMessage({ role: 'assistant', text: content })
      }
      if (p.usage) state.setUsage(p.usage)
    }

    if (p.type === 'usage' && p.usage) {
      state.setUsage(p.usage)
    }

    if (p.type === 'error' && (p as { message?: string }).message) {
      state.pushMessage({
        role: 'system',
        text: String((p as { message?: string }).message),
      })
    }

    if (p.type === 'status' && state.session && p.sessionId === state.session.id) {
      state.session = { ...state.session, status: p.status ?? state.session.status }
    }
  })

  const offLog = api.enpii.onLog((line) => {
    state.pushLog(String(line).trimEnd())
  })

  const offExit = api.enpii.onExit((info) => {
    state.enpiiStatus = 'error'
    state.enpiiInfo = `exited ${JSON.stringify(info)}`
    state.pushLog(`[exit] ${JSON.stringify(info)}`)
  })

  return () => {
    offEvent()
    offLog()
    offExit()
  }
}
