/**
 * Global SQLite session index (FR-D2).
 * Transcripts stay JSON under sessions/projects/<hash>/<id>.json.
 * Index speeds list/lookup; rebuilds from disk when missing/corrupt.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SessionMeta } from './types.js'

function enpiiHome(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function indexPath(): string {
  return path.join(enpiiHome(), 'sessions', 'index.db')
}

function sessionsRoot(): string {
  return path.join(enpiiHome(), 'sessions', 'projects')
}

// Local copies — avoid circular import with persist.ts
function normalizeRoot(projectRoot: string): string {
  return path.resolve(projectRoot).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function projectHash(projectRoot: string): string {
  return crypto.createHash('sha256').update(normalizeRoot(projectRoot)).digest('hex').slice(0, 16)
}

type IndexedSession = {
  meta: SessionMeta
  messages?: unknown[]
}

let db: DatabaseSync | null = null
let dbPath: string | null = null

function openDb(): DatabaseSync {
  const file = indexPath()
  if (db && dbPath === file) return db
  if (db) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    db = null
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const next = new DatabaseSync(file)
  next.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_hash TEXT NOT NULL,
      project_root TEXT NOT NULL,
      base_project_root TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      model TEXT NOT NULL,
      dialect TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      worktree_branch TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      usage_prompt INTEGER,
      usage_completion INTEGER,
      usage_total INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project_hash ON sessions(project_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  `)
  db = next
  dbPath = file
  return next
}

/** Close handle (tests). */
export function closeSessionIndex(): void {
  if (db) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    db = null
  }
}

function rowToMeta(row: Record<string, unknown>): SessionMeta {
  const usagePrompt = row.usage_prompt
  const usageCompletion = row.usage_completion
  const usageTotal = row.usage_total
  const usage =
    typeof usagePrompt === 'number' || typeof usageCompletion === 'number' || typeof usageTotal === 'number'
      ? {
          prompt: Number(usagePrompt ?? 0),
          completion: Number(usageCompletion ?? 0),
          total: Number(usageTotal ?? 0),
        }
      : undefined
  return {
    id: String(row.id),
    contractVersion: '0.1.0',
    projectRoot: String(row.project_root),
    baseProjectRoot: row.base_project_root ? String(row.base_project_root) : undefined,
    worktreeBranch: row.worktree_branch ? String(row.worktree_branch) : undefined,
    title: String(row.title ?? 'New session'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    model: String(row.model ?? 'default'),
    dialect: row.dialect === 'anthropic' ? 'anthropic' : 'openai',
    permissionMode:
      row.permission_mode === 'read_only' ||
      row.permission_mode === 'autopilot_workspace' ||
      row.permission_mode === 'full'
        ? row.permission_mode
        : 'ask',
    status:
      row.status === 'running' ||
      row.status === 'awaiting_approval' ||
      row.status === 'error' ||
      row.status === 'archived'
        ? (row.status as SessionMeta['status'])
        : 'idle',
    usage,
  }
}

export function indexUpsert(meta: SessionMeta, messageCount: number): void {
  try {
    const database = openDb()
    const storageRoot = meta.baseProjectRoot ?? meta.projectRoot
    const hash = projectHash(storageRoot)
    database
      .prepare(
        `INSERT INTO sessions (
          id, project_hash, project_root, base_project_root, title, created_at, updated_at,
          model, dialect, permission_mode, status, worktree_branch, message_count,
          usage_prompt, usage_completion, usage_total
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          project_hash=excluded.project_hash,
          project_root=excluded.project_root,
          base_project_root=excluded.base_project_root,
          title=excluded.title,
          created_at=excluded.created_at,
          updated_at=excluded.updated_at,
          model=excluded.model,
          dialect=excluded.dialect,
          permission_mode=excluded.permission_mode,
          status=excluded.status,
          worktree_branch=excluded.worktree_branch,
          message_count=excluded.message_count,
          usage_prompt=excluded.usage_prompt,
          usage_completion=excluded.usage_completion,
          usage_total=excluded.usage_total`,
      )
      .run(
        meta.id,
        hash,
        path.resolve(meta.projectRoot),
        meta.baseProjectRoot ? path.resolve(meta.baseProjectRoot) : null,
        meta.title,
        meta.createdAt,
        meta.updatedAt,
        meta.model,
        meta.dialect,
        meta.permissionMode,
        meta.status === 'running' || meta.status === 'awaiting_approval' ? 'idle' : meta.status,
        meta.worktreeBranch ?? null,
        messageCount,
        meta.usage?.prompt ?? null,
        meta.usage?.completion ?? null,
        meta.usage?.total ?? null,
      )
  } catch (err) {
    console.error('[enpii] session index upsert failed', err)
  }
}

export function indexList(projectRoot?: string): SessionMeta[] {
  try {
    const database = openDb()
    if (projectRoot) {
      const hash = projectHash(projectRoot)
      const rows = database
        .prepare(`SELECT * FROM sessions WHERE project_hash = ? ORDER BY updated_at DESC`)
        .all(hash) as Record<string, unknown>[]
      // Also match worktree sessions whose base is this project (hash folder = storage root)
      if (rows.length) return rows.map(rowToMeta)
      // empty index for project → rebuild scan
      rebuildIndex()
      const again = database
        .prepare(`SELECT * FROM sessions WHERE project_hash = ? ORDER BY updated_at DESC`)
        .all(hash) as Record<string, unknown>[]
      return again.map(rowToMeta)
    }
    const rows = database.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as Record<
      string,
      unknown
    >[]
    if (!rows.length) {
      rebuildIndex()
      const again = database.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as Record<
        string,
        unknown
      >[]
      return again.map(rowToMeta)
    }
    return rows.map(rowToMeta)
  } catch (err) {
    console.error('[enpii] session index list failed', err)
    return []
  }
}

export function indexGet(sessionId: string): SessionMeta | null {
  try {
    const database = openDb()
    const row = database.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
      | Record<string, unknown>
      | undefined
    return row ? rowToMeta(row) : null
  } catch {
    return null
  }
}

/** Full rebuild from JSON files (idempotent). */
export function rebuildIndex(): number {
  const root = sessionsRoot()
  if (!fs.existsSync(root)) return 0
  let count = 0
  try {
    const database = openDb()
    database.exec('DELETE FROM sessions')
    const dirs = fs.readdirSync(root).map((h) => path.join(root, h))
    for (const dir of dirs) {
      let files: string[]
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      } catch {
        continue
      }
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as IndexedSession
          if (!data?.meta?.id) continue
          indexUpsert(data.meta, Array.isArray(data.messages) ? data.messages.length : 0)
          count++
        } catch {
          /* skip corrupt */
        }
      }
    }
  } catch (err) {
    console.error('[enpii] session index rebuild failed', err)
  }
  return count
}

/** Storage project root for a session id (from index). */
export function indexStorageRoot(sessionId: string): string | null {
  const meta = indexGet(sessionId)
  if (!meta) return null
  return meta.baseProjectRoot ?? meta.projectRoot
}

export function indexSameProject(meta: SessionMeta, projectRoot: string): boolean {
  const want = normalizeRoot(projectRoot)
  if (normalizeRoot(meta.projectRoot) === want) return true
  if (meta.baseProjectRoot && normalizeRoot(meta.baseProjectRoot) === want) return true
  // hash equality for storage
  return projectHash(meta.baseProjectRoot ?? meta.projectRoot) === projectHash(projectRoot)
}
