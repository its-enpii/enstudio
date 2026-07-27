/**
 * In-loop sub-agent: worktree-jailed nested runPromptTurn.
 * Patterns from OH agent/send_message + ClawTeam isolation — own TS contract.
 * Not a background process manager; runs synchronously within the parent tool call.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ProviderConfig } from './config.js'
import { gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove } from './git.js'
import type { SessionRuntime } from './loop.js'
import { projectHash } from './persist.js'
import type { SessionMeta } from './types.js'

// Dynamic import breaks loop ↔ subagent cycle (runPromptTurn lives in loop.ts).
async function nestedTurn(
  ...args: Parameters<typeof import('./loop.js').runPromptTurn>
): ReturnType<typeof import('./loop.js').runPromptTurn> {
  const { runPromptTurn } = await import('./loop.js')
  return runPromptTurn(...args)
}

export type SubAgentRecord = {
  id: string
  name: string
  description: string
  baseProjectRoot: string
  worktreePath: string
  worktreeBranch: string
  sessionId: string
  createdAt: string
  updatedAt: string
  status: 'idle' | 'running' | 'error' | 'stopped'
  lastSummary?: string
}

type LiveSubAgent = SubAgentRecord & {
  runtime: SessionRuntime
}

const live = new Map<string, LiveSubAgent>()
const MAX_AGENTS = 4
const MAX_NESTED_ROUNDS = 4

function home(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function indexPath(baseRoot: string): string {
  return path.join(home(), 'projects', projectHash(baseRoot), 'agents.json')
}

function loadIndex(baseRoot: string): SubAgentRecord[] {
  try {
    const raw = fs.readFileSync(indexPath(baseRoot), 'utf8')
    const data = JSON.parse(raw) as { agents?: SubAgentRecord[] }
    return Array.isArray(data.agents) ? data.agents : []
  } catch {
    return []
  }
}

function saveIndex(baseRoot: string, agents: SubAgentRecord[]): void {
  const file = indexPath(baseRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, agents }, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function upsertIndex(baseRoot: string, rec: SubAgentRecord): void {
  const all = loadIndex(baseRoot).filter((a) => a.id !== rec.id)
  all.push(rec)
  saveIndex(baseRoot, all.slice(-20))
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || `agent-${Date.now().toString(36)}`
}

function nestedPermission(parent: SessionMeta['permissionMode']): SessionMeta['permissionMode'] {
  // Avoid nested approval deadlock: sub-agent never waits on UI.
  if (parent === 'read_only') return 'read_only'
  if (parent === 'full') return 'full'
  return 'autopilot_workspace'
}

function makeRuntime(meta: SessionMeta): SessionRuntime {
  return { meta, messages: [] }
}

function publicRec(a: LiveSubAgent): SubAgentRecord {
  const { runtime: _r, ...rest } = a
  return rest
}

export function listSubAgents(baseRoot: string): SubAgentRecord[] {
  const disk = loadIndex(baseRoot)
  const map = new Map(disk.map((a) => [a.id, a]))
  for (const a of live.values()) {
    if (path.resolve(a.baseProjectRoot) === path.resolve(baseRoot)) map.set(a.id, publicRec(a))
  }
  return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function getSubAgent(id: string): LiveSubAgent | undefined {
  return live.get(id)
}

export type SubAgentEmit = (event: Record<string, unknown>) => void

export async function spawnSubAgent(opts: {
  baseRoot: string
  parentMeta: SessionMeta
  config: ProviderConfig
  description: string
  prompt: string
  name?: string
  /** Skip worktree — jail to base (read-only explore). Default: worktree. */
  isolation?: 'worktree' | 'shared'
  emit?: SubAgentEmit
  parentSessionId?: string
  signal?: AbortSignal
}): Promise<{ ok: true; agent: SubAgentRecord; content: string } | { ok: false; content: string }> {
  const description = opts.description.trim().slice(0, 160)
  const prompt = opts.prompt.trim()
  if (!description) return { ok: false, content: 'agent requires description' }
  if (!prompt) return { ok: false, content: 'agent requires prompt' }

  const active = [...live.values()].filter(
    (a) =>
      path.resolve(a.baseProjectRoot) === path.resolve(opts.baseRoot) &&
      (a.status === 'running' || a.status === 'idle'),
  )
  if (active.length >= MAX_AGENTS) {
    return {
      ok: false,
      content: `max ${MAX_AGENTS} live sub-agents for this project; stop one first`,
    }
  }

  const name = slug(opts.name || description.split(/\s+/).slice(0, 3).join('-'))
  const id = crypto.randomBytes(4).toString('hex')
  const isolation = opts.isolation === 'shared' ? 'shared' : 'worktree'

  let worktreePath = path.resolve(opts.baseRoot)
  let worktreeBranch = ''
  try {
    if (isolation === 'worktree') {
      const wt = gitWorktreeAdd(opts.baseRoot, { name: `sub-${name}-${id}` })
      worktreePath = wt.path
      worktreeBranch = wt.branch ?? ''
    }
  } catch (err) {
    return {
      ok: false,
      content: `agent worktree failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const now = new Date().toISOString()
  const meta: SessionMeta = {
    id: crypto.randomUUID(),
    contractVersion: '0.1.0',
    projectRoot: worktreePath,
    baseProjectRoot: path.resolve(opts.baseRoot),
    worktreeBranch: worktreeBranch || undefined,
    title: `Sub · ${description}`.slice(0, 80),
    createdAt: now,
    updatedAt: now,
    model: opts.config.model,
    dialect: opts.config.dialect,
    permissionMode: nestedPermission(opts.parentMeta.permissionMode),
    status: 'idle',
    loadMemory: false,
  }
  const runtime = makeRuntime(meta)
  runtime.subagentDepth = 1
  // Inherit parent session grants so nested writes/shell match parent allow-session.
  if (opts.parentMeta.permissionMode !== 'read_only') {
    runtime.sessionGrants = new Set(['write', 'shell', 'git', 'mcp'])
  }

  const rec: LiveSubAgent = {
    id,
    name,
    description,
    baseProjectRoot: path.resolve(opts.baseRoot),
    worktreePath,
    worktreeBranch,
    sessionId: meta.id,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    runtime,
  }
  live.set(id, rec)
  upsertIndex(opts.baseRoot, publicRec(rec))

  const parentSid = opts.parentSessionId
  const emit: SubAgentEmit = (event) => {
    opts.emit?.({
      ...event,
      sessionId: parentSid ?? event.sessionId,
      subagentId: id,
      subagentSessionId: meta.id,
    })
  }

  try {
    if (opts.signal?.aborted) throw new Error('stopped')
    const result = await nestedTurn({
      runtime,
      text: prompt,
      config: opts.config,
      emit,
      goal: {
        goal: prompt,
        maxRounds: MAX_NESTED_ROUNDS,
        maxRepairAttempts: 0,
      },
    })
    rec.status = 'idle'
    rec.updatedAt = new Date().toISOString()
    rec.lastSummary = result.content.slice(0, 4_000)
    upsertIndex(opts.baseRoot, publicRec(rec))
    const content = [
      `Spawned sub-agent ${id} (${name})`,
      `isolation=${isolation}`,
      worktreeBranch ? `branch=${worktreeBranch}` : '',
      `worktree=${worktreePath}`,
      `session=${meta.id}`,
      `permission=${meta.permissionMode}`,
      '',
      '--- result ---',
      result.content.slice(0, 12_000) || '(empty)',
    ]
      .filter(Boolean)
      .join('\n')
    return { ok: true, agent: publicRec(rec), content }
  } catch (err) {
    rec.status = 'error'
    rec.updatedAt = new Date().toISOString()
    rec.lastSummary = err instanceof Error ? err.message : String(err)
    upsertIndex(opts.baseRoot, publicRec(rec))
    return {
      ok: false,
      content: `sub-agent ${id} failed: ${rec.lastSummary}`,
    }
  }
}

export async function messageSubAgent(opts: {
  agentId: string
  message: string
  config: ProviderConfig
  emit?: SubAgentEmit
  parentSessionId?: string
  signal?: AbortSignal
}): Promise<{ ok: true; agent: SubAgentRecord; content: string } | { ok: false; content: string }> {
  const id = opts.agentId.trim()
  const message = opts.message.trim()
  if (!id) return { ok: false, content: 'send_message requires agentId' }
  if (!message) return { ok: false, content: 'send_message requires message' }
  const rec = live.get(id)
  if (!rec) {
    return {
      ok: false,
      content: `No live sub-agent ${id}. Spawn with agent first (disk index alone cannot resume nested runtime).`,
    }
  }
  if (rec.status === 'stopped') return { ok: false, content: `sub-agent ${id} is stopped` }
  if (rec.status === 'running') return { ok: false, content: `sub-agent ${id} still running` }

  rec.status = 'running'
  rec.updatedAt = new Date().toISOString()
  const emit: SubAgentEmit = (event) => {
    opts.emit?.({
      ...event,
      sessionId: opts.parentSessionId ?? event.sessionId,
      subagentId: id,
      subagentSessionId: rec.sessionId,
    })
  }
  try {
    if (opts.signal?.aborted) throw new Error('stopped')
    const result = await nestedTurn({
      runtime: rec.runtime,
      text: message,
      config: opts.config,
      emit,
      goal: {
        goal: message,
        maxRounds: MAX_NESTED_ROUNDS,
        maxRepairAttempts: 0,
      },
    })
    rec.status = 'idle'
    rec.updatedAt = new Date().toISOString()
    rec.lastSummary = result.content.slice(0, 4_000)
    upsertIndex(rec.baseProjectRoot, publicRec(rec))
    return {
      ok: true,
      agent: publicRec(rec),
      content: `Message delivered to ${id}\n\n--- result ---\n${result.content.slice(0, 12_000) || '(empty)'}`,
    }
  } catch (err) {
    rec.status = 'error'
    rec.updatedAt = new Date().toISOString()
    rec.lastSummary = err instanceof Error ? err.message : String(err)
    upsertIndex(rec.baseProjectRoot, publicRec(rec))
    return { ok: false, content: `send_message to ${id} failed: ${rec.lastSummary}` }
  }
}

/** Stop live agent; optionally remove worktree. */
export function stopSubAgent(
  agentId: string,
  opts?: { removeWorktree?: boolean },
): { ok: true; content: string } | { ok: false; content: string } {
  const rec = live.get(agentId.trim())
  if (!rec) return { ok: false, content: `No live sub-agent ${agentId}` }
  try {
    rec.runtime.abort?.abort()
  } catch {
    /* */
  }
  rec.status = 'stopped'
  rec.updatedAt = new Date().toISOString()
  if (opts?.removeWorktree && rec.worktreePath !== rec.baseProjectRoot) {
    try {
      gitWorktreeRemove(rec.baseProjectRoot, rec.worktreePath, true)
    } catch {
      /* best-effort */
    }
  }
  live.delete(rec.id)
  upsertIndex(rec.baseProjectRoot, publicRec(rec))
  return { ok: true, content: `Stopped sub-agent ${rec.id}` }
}

/** Test helper. */
export function clearLiveSubAgents(): void {
  live.clear()
}

export function countLiveSubAgents(): number {
  return live.size
}

/** True if path is still a registered worktree of base. */
export function worktreeStillLinked(baseRoot: string, wtPath: string): boolean {
  try {
    return gitWorktreeList(baseRoot).some((w) => path.resolve(w.path) === path.resolve(wtPath))
  } catch {
    return false
  }
}
