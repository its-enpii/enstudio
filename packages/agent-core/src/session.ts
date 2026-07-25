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
          status: existing.status === 'running' ? 'idle' : existing.status,
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
          status: latest.meta.status === 'running' ? 'idle' : latest.meta.status,
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
  }): SessionMeta {
    const projectRoot = canonRoot(params.projectRoot)
    const now = new Date().toISOString()
    const meta: SessionMeta = {
      id: randomUUID(),
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
      ? all.filter((s) => sameProject(s.projectRoot, projectRoot))
      : all
    // de-dupe by id
    const map = new Map(filtered.map((s) => [s.id, s]))
    return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  setStatus(sessionId: string, status: SessionMeta['status']): void {
    const s = this.sessions.get(sessionId) ?? this.get(sessionId)
    if (!s) return
    s.status = status
    s.updatedAt = new Date().toISOString()
    this.sessions.set(sessionId, s)
    this.persist(sessionId)
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
    try {
      saveSession(meta, msgs)
    } catch (err) {
      console.error('[enpii] persist failed', err)
    }
  }

  private ensureMessages(meta?: SessionMeta): void {
    if (!meta) return
    if (this.messages.has(meta.id)) return
    const loaded =
      loadSession(meta.projectRoot, meta.id) ?? loadSessionById(meta.id)
    this.messages.set(meta.id, loaded?.messages ?? [])
  }
}
