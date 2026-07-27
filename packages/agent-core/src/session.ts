import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { SessionMeta } from './types.js'
import {
  listPersisted,
  loadLatest,
  loadSession,
  loadSessionById,
  saveSession,
  sameProject,
  type PersistedSession,
} from './persist.js'
import type { ChatMessage } from './provider/openai.js'

function canonRoot(p: string): string {
  return path.resolve(p)
}

export class SessionStore {
  private sessions = new Map<string, SessionMeta>()
  private messages = new Map<string, ChatMessage[]>()

  constructor() {
    for (const meta of listPersisted()) {
      this.sessions.set(meta.id, meta)
    }
  }

  upsert(params: {
    projectRoot: string
    sessionId?: string
    title?: string
    permissionMode?: SessionMeta['permissionMode']
    model?: string
    dialect?: SessionMeta['dialect']
  }): SessionMeta {
    const projectRoot = canonRoot(params.projectRoot)
    const now = new Date().toISOString()

    if (params.sessionId) {
      const existing =
        this.sessions.get(params.sessionId) ??
        loadSession(projectRoot, params.sessionId)?.meta ??
        loadSessionById(params.sessionId)?.meta
      if (existing) {
        const disk = loadSessionById(existing.id)
        const next: SessionMeta = {
          ...existing,
          title: params.title ?? existing.title,
          permissionMode: params.permissionMode ?? existing.permissionMode,
          model: params.model ?? existing.model,
          dialect: params.dialect ?? existing.dialect,
          projectRoot,
          updatedAt: now,
          status: existing.status === 'running' || existing.status === 'awaiting_approval' ? 'idle' : existing.status,
        }
        this.sessions.set(next.id, next)
        if (!this.messages.has(next.id)) {
          this.messages.set(next.id, disk?.messages ?? [])
        }
        this.persist(next.id)
        return next
      }
    }

    // resume latest for project when no sessionId
    if (!params.sessionId) {
      const latest = loadLatest(projectRoot)
      if (latest) {
        const next: SessionMeta = {
          ...latest.meta,
          title: params.title ?? latest.meta.title,
          permissionMode: params.permissionMode ?? latest.meta.permissionMode,
          model: params.model ?? latest.meta.model,
          dialect: params.dialect ?? latest.meta.dialect,
          projectRoot,
          updatedAt: now,
          status: latest.meta.status === 'running' || latest.meta.status === 'awaiting_approval' ? 'idle' : latest.meta.status,
        }
        this.sessions.set(next.id, next)
        this.messages.set(next.id, latest.messages ?? [])
        this.persist(next.id)
        return next
      }
    }

    const meta: SessionMeta = {
      id: params.sessionId ?? randomUUID(),
      contractVersion: '0.1.0',
      projectRoot,
      title: params.title ?? 'New session',
      createdAt: now,
      updatedAt: now,
      model: params.model ?? 'default',
      dialect: params.dialect ?? 'anthropic',
      permissionMode: params.permissionMode ?? 'ask',
      status: 'idle',
    }
    this.sessions.set(meta.id, meta)
    this.messages.set(meta.id, [])
    this.persist(meta.id)
    return meta
  }

  create(params: {
    projectRoot: string
    title?: string
    permissionMode?: SessionMeta['permissionMode']
    model?: string
    dialect?: SessionMeta['dialect']
    baseProjectRoot?: string
    worktreeBranch?: string
    loadMemory?: boolean
  }): SessionMeta {
    const projectRoot = canonRoot(params.projectRoot)
    const now = new Date().toISOString()
    const meta: SessionMeta = {
      id: randomUUID(),
      contractVersion: '0.1.0',
      projectRoot,
      baseProjectRoot: params.baseProjectRoot ? canonRoot(params.baseProjectRoot) : undefined,
      worktreeBranch: params.worktreeBranch,
      title: params.title ?? 'New session',
      createdAt: now,
      updatedAt: now,
      model: params.model ?? 'default',
      dialect: params.dialect ?? 'anthropic',
      permissionMode: params.permissionMode ?? 'ask',
      loadMemory: params.loadMemory,
      status: 'idle',
    }
    this.sessions.set(meta.id, meta)
    this.messages.set(meta.id, [])
    this.persist(meta.id)
    return meta
  }

  get(sessionId: string): SessionMeta | undefined {
    const mem = this.sessions.get(sessionId)
    if (mem) {
      this.ensureMessages(mem)
      return mem
    }
    const loaded = loadSessionById(sessionId)
    if (loaded) {
      this.sessions.set(sessionId, loaded.meta)
      this.messages.set(sessionId, loaded.messages ?? [])
      return loaded.meta
    }
    return undefined
  }

  list(projectRoot?: string): SessionMeta[] {
    const disk = listPersisted(projectRoot)
    for (const m of disk) this.sessions.set(m.id, m)
    const all = [...this.sessions.values()]
    const filtered = projectRoot
      ? all.filter(
          (s) =>
            sameProject(s.projectRoot, projectRoot) ||
            (s.baseProjectRoot ? sameProject(s.baseProjectRoot, projectRoot) : false),
        )
      : all
    for (const session of filtered) this.ensureMessages(session)
    // de-dupe by id
    const map = new Map(filtered.map((s) => [s.id, s]))
    return [...map.values()]
      .filter((session) => {
        if (session.status === 'archived') return false
        const n = this.messages.get(session.id)?.length ?? 0
        // Keep empty worktree sessions so Linked worktrees can re-open them.
        if (n > 0) return true
        return Boolean(session.baseProjectRoot || session.worktreeBranch)
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  setStatus(sessionId: string, status: SessionMeta['status']): void {
    const s = this.sessions.get(sessionId) ?? this.get(sessionId)
    if (!s) return
    s.status = status
    s.updatedAt = new Date().toISOString()
    this.sessions.set(sessionId, s)
    this.persist(sessionId)
  }

  setLoadMemory(sessionId: string, loadMemory: boolean): SessionMeta | undefined {
    const s = this.sessions.get(sessionId) ?? this.get(sessionId)
    if (!s) return undefined
    s.loadMemory = loadMemory
    s.updatedAt = new Date().toISOString()
    this.sessions.set(sessionId, s)
    this.persist(sessionId)
    return s
  }

  getMessages(sessionId: string): ChatMessage[] {
    const meta = this.sessions.get(sessionId) ?? this.get(sessionId)
    this.ensureMessages(meta)
    return this.messages.get(sessionId) ?? []
  }

  setMessages(sessionId: string, messages: ChatMessage[]): void {
    this.messages.set(sessionId, messages)
    const s = this.sessions.get(sessionId)
    if (s) s.updatedAt = new Date().toISOString()
    this.persist(sessionId)
  }

  /** Add provider usage into session totals and persist. */
  addUsage(
    sessionId: string,
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
  ): SessionMeta['usage'] | undefined {
    if (!usage) return this.sessions.get(sessionId)?.usage
    const s = this.sessions.get(sessionId) ?? this.get(sessionId)
    if (!s) return undefined
    const add = {
      prompt: usage.prompt_tokens ?? 0,
      completion: usage.completion_tokens ?? 0,
      total: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    }
    s.usage = s.usage
      ? {
          prompt: s.usage.prompt + add.prompt,
          completion: s.usage.completion + add.completion,
          total: s.usage.total + add.total,
        }
      : add
    s.updatedAt = new Date().toISOString()
    this.sessions.set(sessionId, s)
    this.persist(sessionId)
    return s.usage
  }

  loadPersisted(sessionId: string): PersistedSession | null {
    const meta = this.get(sessionId)
    if (!meta) return null
    this.ensureMessages(meta)
    return { meta, messages: this.messages.get(sessionId) ?? [] }
  }

  persist(sessionId: string): void {
    const meta = this.sessions.get(sessionId)
    if (!meta) return
    const msgs = this.messages.get(sessionId) ?? []
    if (msgs.length === 0) return
    try {
      saveSession(meta, msgs)
    } catch (err) {
      console.error('[enpii] persist failed', err)
    }
  }

  private ensureMessages(meta?: SessionMeta): void {
    if (!meta) return
    const cached = this.messages.get(meta.id)
    if (cached?.length) return
    const loaded = loadSession(meta.projectRoot, meta.id) ?? loadSessionById(meta.id)
    if (loaded?.messages?.length || !this.messages.has(meta.id)) {
      this.messages.set(meta.id, loaded?.messages ?? [])
    }
  }
}
