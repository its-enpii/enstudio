import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SessionMeta } from './types.js'
import type { ChatMessage } from './provider/openai.js'

export interface PersistedSession {
  meta: SessionMeta
  messages: ChatMessage[]
}

function sessionsRoot(): string {
  return path.join(os.homedir(), '.enpiistudio', 'sessions', 'projects')
}

/** Canonical path for hashing + equality (Windows-safe). */
export function normalizeRoot(projectRoot: string): string {
  return path.resolve(projectRoot).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function projectHash(projectRoot: string): string {
  return crypto.createHash('sha256').update(normalizeRoot(projectRoot)).digest('hex').slice(0, 16)
}

export function sameProject(a: string, b: string): boolean {
  return normalizeRoot(a) === normalizeRoot(b)
}

function projectDir(projectRoot: string): string {
  return path.join(sessionsRoot(), projectHash(projectRoot))
}

function sessionPath(projectRoot: string, sessionId: string): string {
  return path.join(projectDir(projectRoot), `${sessionId}.json`)
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function saveSession(meta: SessionMeta, messages: ChatMessage[]): void {
  const dir = projectDir(meta.projectRoot)
  ensureDir(dir)
  const payload: PersistedSession = {
    meta: {
      ...meta,
      projectRoot: path.resolve(meta.projectRoot),
      status: meta.status === 'running' ? 'idle' : meta.status,
    },
    messages: sanitizeMessages(messages),
  }
  const file = sessionPath(meta.projectRoot, meta.id)
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8')
}

export function loadSession(
  projectRoot: string,
  sessionId: string,
): PersistedSession | null {
  try {
    const raw = fs.readFileSync(sessionPath(projectRoot, sessionId), 'utf8')
    const data = JSON.parse(raw) as PersistedSession
    if (!data?.meta?.id) return null
    return data
  } catch {
    return null
  }
}

/** Find session file by id under any project hash folder. */
export function loadSessionById(sessionId: string): PersistedSession | null {
  const root = sessionsRoot()
  if (!fs.existsSync(root)) return null
  let dirs: string[]
  try {
    dirs = fs.readdirSync(root).map((h) => path.join(root, h))
  } catch {
    return null
  }
  for (const dir of dirs) {
    const file = path.join(dir, `${sessionId}.json`)
    if (!fs.existsSync(file)) continue
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedSession
      if (data?.meta?.id === sessionId) return data
    } catch {
      /* skip */
    }
  }
  return null
}

export function listPersisted(projectRoot?: string): SessionMeta[] {
  const root = sessionsRoot()
  if (!fs.existsSync(root)) return []

  const dirs = projectRoot
    ? [projectDir(projectRoot)].filter((d) => fs.existsSync(d))
    : fs.readdirSync(root).map((h) => path.join(root, h))

  const out: SessionMeta[] = []
  for (const dir of dirs) {
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8')
        const data = JSON.parse(raw) as PersistedSession
        if (!data?.meta?.id) continue
        if (projectRoot && !sameProject(data.meta.projectRoot, projectRoot)) {
          // hash folder match is enough; keep
        }
        out.push(data.meta)
      } catch {
        /* skip corrupt */
      }
    }
  }

  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function loadLatest(projectRoot: string): PersistedSession | null {
  const list = listPersisted(projectRoot)
  if (!list.length) return null
  // Prefer session that actually has messages
  for (const meta of list) {
    const full = loadSession(projectRoot, meta.id) ?? loadSessionById(meta.id)
    if (full && full.messages.length > 0) return full
  }
  return loadSession(projectRoot, list[0]!.id) ?? loadSessionById(list[0]!.id)
}

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 40_000) {
      return { ...m, content: m.content.slice(0, 40_000) + '\n… truncated for storage' }
    }
    return m
  })
}
