import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GoalContract, RunState, RunStatus } from './types.js'

const MAX_ROUNDS = 32
const MAX_TOKENS = 1_000_000
const MAX_RUNTIME_MS = 24 * 60 * 60_000

function root(): string {
  return path.join(os.homedir(), '.enpiistudio', 'runs')
}

function file(sessionId: string, runId: string): string {
  return path.join(root(), sessionId, `${runId}.json`)
}

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : NaN
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

export function normalizeGoal(input: unknown, fallback: string): GoalContract {
  const raw = typeof input === 'string' ? { goal: input } : (input ?? {}) as Record<string, unknown>
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : fallback.trim()
  if (!goal) throw new Error('goal is required')
  const criteria = Array.isArray(raw.acceptanceCriteria)
    ? raw.acceptanceCriteria.filter((v): v is string => typeof v === 'string' && Boolean(v.trim())).map((v) => v.trim()).slice(0, 20)
    : undefined
  const verificationCommands = Array.isArray(raw.verificationCommands)
    ? raw.verificationCommands
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value) => value.trim().slice(0, 500))
      .slice(0, 5)
    : undefined
  return {
    goal,
    acceptanceCriteria: criteria,
    maxRounds: finiteInt(raw.maxRounds, 8, 1, MAX_ROUNDS),
    maxTokens: finiteInt(raw.maxTokens, MAX_TOKENS, 1_000, MAX_TOKENS),
    maxRuntimeMs: finiteInt(raw.maxRuntimeMs, 30 * 60_000, 1_000, MAX_RUNTIME_MS),
    maxRepairAttempts: finiteInt(raw.maxRepairAttempts, 1, 0, 3),
    verificationCommands,
  }
}

export function createRunState(sessionId: string, goal: GoalContract): RunState {
  const now = new Date().toISOString()
  return {
    sessionId,
    runId: crypto.randomUUID(),
    goal,
    tasks: [
      { id: 'plan', title: 'Plan task', status: 'running' },
      { id: 'inspect', title: 'Inspect workspace', status: 'pending' },
      { id: 'change', title: 'Make changes', status: 'pending' },
      { id: 'verify', title: 'Verify result', status: 'pending' },
    ],
    status: 'queued',
    round: 0,
    toolCount: 0,
    repairAttempts: 0,
    startedAt: now,
    updatedAt: now,
  }
}

export function saveRunState(state: RunState): void {
  const dir = path.dirname(file(state.sessionId, state.runId))
  fs.mkdirSync(dir, { recursive: true })
  const target = file(state.sessionId, state.runId)
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, target)
}

export function updateRunState(
  state: RunState,
  patch: Partial<Pick<RunState, 'status' | 'round' | 'toolCount' | 'repairAttempts' | 'usage' | 'lastEvent' | 'error' | 'tasks'>>,
): RunState {
  const next: RunState = { ...state, ...patch, updatedAt: new Date().toISOString() }
  if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
    next.finishedAt ??= next.updatedAt
  }
  saveRunState(next)
  return next
}

export function finishRunState(state: RunState, status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>, error?: string): RunState {
  return updateRunState(state, { status, error })
}
