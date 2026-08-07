/**
 * In-loop sub-agent: worktree-jailed nested runPromptTurn.
 * Patterns from OH agent/send_message + ClawTeam isolation — own TS contract.
 * Default spawn is sync (awaits nested turn). async:true returns agentId while nested runs.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getVendorSubagentProvider, type ProviderConfig } from './config.js'
import {
  gitWorktreeAdd,
  gitWorktreeApply,
  gitWorktreeDiscard,
  gitWorktreeList,
  gitWorktreeRemove,
} from './git.js'
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
  return { meta, messages: [], abort: new AbortController() }
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

/** Shared with parent-session `handoff` tool. */
export const ROLE_PREAMBLE: Record<string, string> = {
  scout:
    'Role: SCOUT. Read-only investigation. Prefer list/read/grep/search. Do not write files or run mutating shell unless unavoidable. Return findings + paths.',
  implement:
    'Role: IMPLEMENT. Make the smallest focused edits to satisfy the prompt. Prefer edit_file. Summarize files changed.',
  review:
    'Role: REVIEW. Critique risk, bugs, missing tests. Prefer read tools. Do not implement fixes unless asked; return a short review.',
}

async function runNestedJob(opts: {
  rec: LiveSubAgent
  prompt: string
  config: ProviderConfig
  emit: SubAgentEmit
  signal?: AbortSignal
  parentSessionId?: string
  isolation: string
}): Promise<{ ok: boolean; content: string }> {
  const { rec } = opts
  try {
    if (opts.signal?.aborted) throw new Error('stopped')
    const result = await nestedTurn({
      runtime: rec.runtime,
      text: opts.prompt,
      config: opts.config,
      emit: opts.emit,
      goal: {
        goal: opts.prompt,
        maxRounds: MAX_NESTED_ROUNDS,
        maxRepairAttempts: 0,
      },
    })
    rec.status = 'idle'
    rec.updatedAt = new Date().toISOString()
    rec.lastSummary = result.content.slice(0, 4_000)
    upsertIndex(rec.baseProjectRoot, publicRec(rec))
    const body = result.content.slice(0, 12_000) || '(empty)'
    opts.emit({
      type: 'subagent_done',
      sessionId: opts.parentSessionId ?? rec.sessionId,
      subagentId: rec.id,
      subagentSessionId: rec.sessionId,
      ok: true,
      name: rec.name,
      description: rec.description,
      summary: rec.lastSummary,
      worktreePath: rec.worktreePath,
      worktreeBranch: rec.worktreeBranch,
    })
    return { ok: true, content: body }
  } catch (err) {
    rec.status = 'error'
    rec.updatedAt = new Date().toISOString()
    rec.lastSummary = err instanceof Error ? err.message : String(err)
    upsertIndex(rec.baseProjectRoot, publicRec(rec))
    opts.emit({
      type: 'subagent_done',
      sessionId: opts.parentSessionId ?? rec.sessionId,
      subagentId: rec.id,
      subagentSessionId: rec.sessionId,
      ok: false,
      name: rec.name,
      description: rec.description,
      summary: rec.lastSummary,
      worktreePath: rec.worktreePath,
      worktreeBranch: rec.worktreeBranch,
    })
    return { ok: false, content: rec.lastSummary ?? 'failed' }
  }
}

export async function spawnSubAgent(opts: {
  baseRoot: string
  parentMeta: SessionMeta
  config: ProviderConfig
  description: string
  prompt: string
  name?: string
  /** scout | implement | review — prepended to nested prompt. */
  role?: string
  /** Skip worktree — jail to base (read-only explore). Default: worktree. */
  isolation?: 'worktree' | 'shared'
  /**
   * async=true: return agentId immediately; nested turn continues in background.
   * Parent is not blocked. Default false (sync await, legacy).
   */
  async?: boolean
  vendor?: string
  model?: string
  emit?: SubAgentEmit
  parentSessionId?: string
  signal?: AbortSignal
}): Promise<
  | { ok: true; agent: SubAgentRecord; content: string; async?: boolean }
  | { ok: false; content: string }
> {
  const description = opts.description.trim().slice(0, 160)
  const roleKey = String(opts.role ?? '').trim().toLowerCase()
  const roleLine = ROLE_PREAMBLE[roleKey]
  const prompt = [roleLine, opts.prompt.trim()].filter(Boolean).join('\n\n')
  if (!description) return { ok: false, content: 'agent requires description' }
  if (!opts.prompt.trim()) return { ok: false, content: 'agent requires prompt' }

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
  const runAsync = opts.async === true

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

  const vendor = opts.vendor ?? 'enpii'
  const effectiveConfig = getVendorSubagentProvider(opts.config, vendor)
  if (opts.model?.trim()) {
    effectiveConfig.model = opts.model.trim()
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
  // Scout: force read_only before runtime materializes permission checks.
  if (roleKey === 'scout') meta.permissionMode = 'read_only'
  const runtime = makeRuntime(meta)
  runtime.subagentDepth = 1
  // Inherit parent session grants so nested writes/shell match parent allow-session.
  if (meta.permissionMode !== 'read_only') {
    runtime.sessionGrants = new Set(['write', 'shell', 'git', 'mcp'])
  } else {
    runtime.sessionGrants = new Set()
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

  opts.emit?.({
    type: 'subagent_start',
    sessionId: parentSid ?? meta.id,
    subagentId: id,
    subagentSessionId: meta.id,
    name,
    description,
    async: runAsync,
    worktreePath,
    worktreeBranch,
  })

  const jobOpts = {
    rec,
    prompt,
    config: opts.config,
    emit,
    signal: opts.signal,
    parentSessionId: parentSid,
    isolation,
  }

  if (runAsync) {
    // Fire-and-forget: parent tool returns; nested turn continues.
    void runNestedJob(jobOpts)
    const content = [
      `Spawned sub-agent ${id} (${name}) async=true`,
      `isolation=${isolation}`,
      worktreeBranch ? `branch=${worktreeBranch}` : '',
      `worktree=${worktreePath}`,
      `session=${meta.id}`,
      `permission=${meta.permissionMode}`,
      `status=running`,
      '',
      'Nested turn running in background. Use send_message when idle, or agent_apply/agent_discard when done.',
      'Event subagent_done fires on finish.',
    ]
      .filter(Boolean)
      .join('\n')
    return { ok: true, agent: publicRec(rec), content, async: true }
  }

  const finished = await runNestedJob(jobOpts)
  if (!finished.ok) {
    return { ok: false, content: `sub-agent ${id} failed: ${finished.content}` }
  }
  const content = [
    `Spawned sub-agent ${id} (${name})`,
    `isolation=${isolation}`,
    worktreeBranch ? `branch=${worktreeBranch}` : '',
    `worktree=${worktreePath}`,
    `session=${meta.id}`,
    `permission=${meta.permissionMode}`,
    '',
    '--- result ---',
    finished.content,
  ]
    .filter(Boolean)
    .join('\n')
  return { ok: true, agent: publicRec(rec), content }
}

/** Merge sub-agent worktree into base project (main). Sub must be idle/error, not running. */
export function applySubAgentWorktree(
  agentId: string,
  opts?: { remove?: boolean; keepBranch?: boolean },
): { ok: true; content: string; conflicts?: unknown[] } | { ok: false; content: string } {
  const id = agentId.trim()
  const rec = live.get(id)
  if (!rec) {
    return {
      ok: false,
      content: `No live sub-agent ${id}. Spawn must still be in this process to apply.`,
    }
  }
  if (rec.status === 'running') {
    return { ok: false, content: `sub-agent ${id} still running — wait for subagent_done` }
  }
  if (rec.status === 'stopped') {
    return { ok: false, content: `sub-agent ${id} stopped` }
  }
  if (path.resolve(rec.worktreePath) === path.resolve(rec.baseProjectRoot)) {
    return { ok: false, content: `sub-agent ${id} has no separate worktree to apply (shared isolation?)` }
  }
  try {
    const result = gitWorktreeApply(rec.baseProjectRoot, rec.worktreePath, {
      remove: opts?.remove !== false,
      keepBranch: opts?.keepBranch === true,
    })
    if (result.conflicts?.length) {
      return {
        ok: true,
        content: `Apply conflicts on ${result.merged}: ${result.conflicts.map((c) => c.path).join(', ')}. Resolve in Git mode.`,
        conflicts: result.conflicts,
      }
    }
    if (result.removed) {
      rec.status = 'stopped'
      rec.updatedAt = new Date().toISOString()
      live.delete(rec.id)
      upsertIndex(rec.baseProjectRoot, publicRec(rec))
    }
    return {
      ok: true,
      content: [
        `Applied sub-agent ${id} → main`,
        `merged=${result.merged}`,
        result.removed ? 'worktree removed' : 'worktree kept',
        result.keptBranch ? `keptBranch=${result.keptBranch}` : '',
        rec.worktreeBranch ? `branch was ${rec.worktreeBranch}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  } catch (err) {
    return {
      ok: false,
      content: `agent_apply failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Discard sub-agent worktree (no merge). Stops live agent. */
export function discardSubAgentWorktree(
  agentId: string,
  opts?: { deleteBranch?: boolean },
): { ok: true; content: string } | { ok: false; content: string } {
  const id = agentId.trim()
  const rec = live.get(id)
  if (!rec) return { ok: false, content: `No live sub-agent ${id}` }
  if (rec.status === 'running') {
    try {
      rec.runtime.abort?.abort()
    } catch {
      /* */
    }
  }
  const branch = rec.worktreeBranch
  const base = rec.baseProjectRoot
  const wt = rec.worktreePath
  try {
    if (wt && path.resolve(wt) !== path.resolve(base)) {
      gitWorktreeDiscard(base, wt, {
        deleteBranch: opts?.deleteBranch !== false,
        branchHint: branch,
      })
    }
  } catch (err) {
    return {
      ok: false,
      content: `agent_discard failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  rec.status = 'stopped'
  rec.updatedAt = new Date().toISOString()
  live.delete(rec.id)
  upsertIndex(rec.baseProjectRoot, publicRec(rec))
  return {
    ok: true,
    content: `Discarded sub-agent ${id}${branch ? ` (${branch})` : ''}`,
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
