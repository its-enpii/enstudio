/**
 * Durable project cron jobs (agent_turn prompts).
 * Fires while the enpii sidecar is alive; state under ENPII_HOME/projects/<hash>/cron.json.
 * Minimal 5-field cron matcher (local timezone). No shell jobs.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectHash } from './persist.js'

export type CronJob = {
  id: string
  name: string
  /** 5-field cron: m h dom mon dow */
  schedule: string
  /** Prompt text for agent turn */
  prompt: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  nextRunAt?: string
  runCount: number
  lastError?: string
  lastSessionId?: string
}

type CronFile = {
  version: 1
  projectRoot: string
  updatedAt: string
  jobs: CronJob[]
}

const MAX_JOBS = 50
const MAX_NAME = 80
const MAX_PROMPT = 4000
const TICK_MS = 15_000

function home(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function cronPath(projectRoot: string): string {
  return path.join(home(), 'projects', projectHash(projectRoot), 'cron.json')
}

function nowIso(): string {
  return new Date().toISOString()
}

function slugId(): string {
  return crypto.randomBytes(4).toString('hex')
}

function ensureFile(projectRoot: string): CronFile {
  const file = cronPath(projectRoot)
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw) as CronFile
    if (data?.version === 1 && Array.isArray(data.jobs)) {
      return {
        version: 1,
        projectRoot: path.resolve(projectRoot),
        updatedAt: data.updatedAt || nowIso(),
        jobs: data.jobs.slice(0, MAX_JOBS),
      }
    }
  } catch {
    /* fresh */
  }
  return {
    version: 1,
    projectRoot: path.resolve(projectRoot),
    updatedAt: nowIso(),
    jobs: [],
  }
}

function saveFile(projectRoot: string, data: CronFile): void {
  const file = cronPath(projectRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  data.updatedAt = nowIso()
  data.projectRoot = path.resolve(projectRoot)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

/** Parse one cron field into match predicate for n. */
function fieldMatch(field: string, n: number, min: number, max: number): boolean {
  const f = field.trim()
  if (!f) return false
  if (f === '*') return true
  for (const part of f.split(',')) {
    const p = part.trim()
    if (!p) continue
    const stepMatch = /^(\*|\d+(?:-\d+)?)\/(\d+)$/.exec(p)
    if (stepMatch) {
      const step = Number(stepMatch[2])
      if (!Number.isFinite(step) || step <= 0) return false
      const base = stepMatch[1]!
      if (base === '*') {
        if (n >= min && n <= max && (n - min) % step === 0) return true
        continue
      }
      const range = base.includes('-') ? base.split('-').map(Number) : [Number(base), Number(base)]
      const a = range[0]!
      const b = range[1]!
      if (n >= a && n <= b && (n - a) % step === 0) return true
      continue
    }
    if (p.includes('-')) {
      const [aS, bS] = p.split('-')
      const a = Number(aS)
      const b = Number(bS)
      if (Number.isFinite(a) && Number.isFinite(b) && n >= a && n <= b) return true
      continue
    }
    if (Number(p) === n) return true
  }
  return false
}

export function validateCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ]
  for (let i = 0; i < 5; i++) {
    const f = parts[i]!
    if (!/^(\*|(\d{1,2})(-\d{1,2})?)(\/\d{1,2})?(,(\*|(\d{1,2})(-\d{1,2})?)(\/\d{1,2})?)*$/.test(f)) {
      return false
    }
    // reject out-of-range bare numbers
    for (const tok of f.split(',')) {
      const bare = tok.replace(/\/\d+$/, '')
      if (bare === '*') continue
      const nums = bare.split('-').map(Number)
      for (const n of nums) {
        if (!Number.isFinite(n) || n < ranges[i]![0] || n > ranges[i]![1]) return false
      }
    }
  }
  return true
}

export function cronMatches(expr: string, date: Date): boolean {
  if (!validateCronExpression(expr)) return false
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/)
  return (
    fieldMatch(m!, date.getMinutes(), 0, 59) &&
    fieldMatch(h!, date.getHours(), 0, 23) &&
    fieldMatch(dom!, date.getDate(), 1, 31) &&
    fieldMatch(mon!, date.getMonth() + 1, 1, 12) &&
    fieldMatch(dow!, date.getDay(), 0, 6)
  )
}

/** Next fire time at or after `from` (minute resolution, local). Caps scan at 366 days. */
export function nextCronFire(expr: string, from: Date = new Date()): Date | undefined {
  if (!validateCronExpression(expr)) return undefined
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  // if already past this minute's second 0 and matched, still advance one minute for "next"
  d.setMinutes(d.getMinutes() + 1)
  const limit = d.getTime() + 366 * 24 * 60 * 60 * 1000
  while (d.getTime() < limit) {
    if (cronMatches(expr, d)) return new Date(d.getTime())
    d.setMinutes(d.getMinutes() + 1)
  }
  return undefined
}

function formatJob(j: CronJob): string {
  const bits = [`#${j.id}`, j.enabled ? 'on' : 'off', j.schedule, j.name, `runs=${j.runCount}`]
  if (j.nextRunAt) bits.push(`next=${j.nextRunAt}`)
  if (j.lastRunAt) bits.push(`last=${j.lastRunAt}`)
  if (j.lastError) bits.push(`err=${j.lastError.slice(0, 80)}`)
  return bits.join(' ')
}

export function cronCreate(
  projectRoot: string,
  input: { name?: string; schedule?: string; prompt?: string; message?: string; enabled?: boolean },
): { ok: true; job: CronJob; content: string } | { ok: false; content: string } {
  const name = String(input.name ?? '').trim().slice(0, MAX_NAME)
  const schedule = String(input.schedule ?? '').trim()
  const prompt = String(input.prompt ?? input.message ?? '').trim().slice(0, MAX_PROMPT)
  if (!name) return { ok: false, content: 'cron_create requires name' }
  if (!validateCronExpression(schedule)) {
    return {
      ok: false,
      content: `invalid cron schedule ${JSON.stringify(schedule)} — use 5 fields: m h dom mon dow`,
    }
  }
  if (!prompt) return { ok: false, content: 'cron_create requires prompt' }
  const data = ensureFile(projectRoot)
  const existing = data.jobs.find((j) => j.name === name)
  const ts = nowIso()
  const next = nextCronFire(schedule)?.toISOString()
  if (existing) {
    existing.schedule = schedule
    existing.prompt = prompt
    existing.enabled = input.enabled !== false
    existing.updatedAt = ts
    existing.nextRunAt = existing.enabled ? next : undefined
    existing.lastError = undefined
    saveFile(projectRoot, data)
    return { ok: true, job: existing, content: `updated ${formatJob(existing)}` }
  }
  if (data.jobs.length >= MAX_JOBS) return { ok: false, content: `max ${MAX_JOBS} cron jobs` }
  const job: CronJob = {
    id: slugId(),
    name,
    schedule,
    prompt,
    enabled: input.enabled !== false,
    createdAt: ts,
    updatedAt: ts,
    runCount: 0,
    nextRunAt: input.enabled !== false ? next : undefined,
  }
  data.jobs.push(job)
  saveFile(projectRoot, data)
  return { ok: true, job, content: `created ${formatJob(job)}` }
}

export function cronList(
  projectRoot: string,
  filter?: { enabled?: boolean },
): { ok: true; jobs: CronJob[]; content: string } {
  const data = ensureFile(projectRoot)
  let jobs = data.jobs
  if (typeof filter?.enabled === 'boolean') jobs = jobs.filter((j) => j.enabled === filter.enabled)
  return {
    ok: true,
    jobs,
    content: jobs.length ? jobs.map(formatJob).join('\n') : '(no cron jobs)',
  }
}

export function cronDelete(
  projectRoot: string,
  idOrName: string,
): { ok: true; content: string } | { ok: false; content: string } {
  const key = String(idOrName ?? '').trim()
  if (!key) return { ok: false, content: 'cron_delete requires id or name' }
  const data = ensureFile(projectRoot)
  const before = data.jobs.length
  data.jobs = data.jobs.filter((j) => j.id !== key && j.name !== key)
  if (data.jobs.length === before) return { ok: false, content: `cron job not found: ${key}` }
  saveFile(projectRoot, data)
  return { ok: true, content: `deleted cron ${key}` }
}

export function cronToggle(
  projectRoot: string,
  idOrName: string,
  enabled?: boolean,
): { ok: true; job: CronJob; content: string } | { ok: false; content: string } {
  const key = String(idOrName ?? '').trim()
  if (!key) return { ok: false, content: 'cron_toggle requires id or name' }
  const data = ensureFile(projectRoot)
  const job = data.jobs.find((j) => j.id === key || j.name === key)
  if (!job) return { ok: false, content: `cron job not found: ${key}` }
  job.enabled = typeof enabled === 'boolean' ? enabled : !job.enabled
  job.updatedAt = nowIso()
  job.nextRunAt = job.enabled ? nextCronFire(job.schedule)?.toISOString() : undefined
  saveFile(projectRoot, data)
  return { ok: true, job, content: `${job.enabled ? 'enabled' : 'disabled'} ${formatJob(job)}` }
}

export type DueCronJob = {
  projectRoot: string
  job: CronJob
}

/** Mark job just fired; advance nextRunAt past this minute. */
export function cronMarkRan(
  projectRoot: string,
  jobId: string,
  result: { ok: boolean; sessionId?: string; error?: string },
): void {
  const data = ensureFile(projectRoot)
  const job = data.jobs.find((j) => j.id === jobId)
  if (!job) return
  const ts = nowIso()
  job.lastRunAt = ts
  job.runCount += 1
  job.updatedAt = ts
  job.lastSessionId = result.sessionId
  job.lastError = result.ok ? undefined : (result.error ?? 'failed').slice(0, 500)
  // skip current minute so we don't double-fire in same tick window
  const after = new Date()
  after.setSeconds(0, 0)
  job.nextRunAt = job.enabled ? nextCronFire(job.schedule, after)?.toISOString() : undefined
  saveFile(projectRoot, data)
}

/** Scan known project cron files under ENPII_HOME/projects/<hash>/cron.json */
export function listAllCronProjectRoots(): string[] {
  const root = path.join(home(), 'projects')
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const file = path.join(root, ent.name, 'cron.json')
    if (!fs.existsSync(file)) continue
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as CronFile
      if (data?.projectRoot) out.push(path.resolve(data.projectRoot))
    } catch {
      /* skip */
    }
  }
  return out
}

export function collectDueCronJobs(at: Date = new Date()): DueCronJob[] {
  const due: DueCronJob[] = []
  const minute = new Date(at.getTime())
  minute.setSeconds(0, 0)
  for (const projectRoot of listAllCronProjectRoots()) {
    const data = ensureFile(projectRoot)
    let dirty = false
    for (const job of data.jobs) {
      if (!job.enabled) continue
      if (!validateCronExpression(job.schedule)) continue
      // already ran this minute
      if (job.lastRunAt) {
        const last = new Date(job.lastRunAt)
        if (
          last.getFullYear() === minute.getFullYear() &&
          last.getMonth() === minute.getMonth() &&
          last.getDate() === minute.getDate() &&
          last.getHours() === minute.getHours() &&
          last.getMinutes() === minute.getMinutes()
        ) {
          continue
        }
      }
      if (cronMatches(job.schedule, minute)) {
        due.push({ projectRoot, job: { ...job } })
      } else if (!job.nextRunAt) {
        job.nextRunAt = nextCronFire(job.schedule, minute)?.toISOString()
        dirty = true
      }
    }
    if (dirty) saveFile(projectRoot, data)
  }
  return due
}

export type CronFireHandler = (due: DueCronJob) => Promise<void>

let tickTimer: ReturnType<typeof setInterval> | undefined
let ticking = false

export function startCronScheduler(handler: CronFireHandler, intervalMs = TICK_MS): void {
  stopCronScheduler()
  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      const due = collectDueCronJobs()
      for (const item of due) {
        try {
          await handler(item)
        } catch (err) {
          cronMarkRan(item.projectRoot, item.job.id, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    } finally {
      ticking = false
    }
  }
  void tick()
  tickTimer = setInterval(() => void tick(), intervalMs)
  // unref so scheduler doesn't keep process alive alone if desired — keep ref'd while sidecar runs
  if (typeof tickTimer === 'object' && 'unref' in tickTimer) {
    /* keep process alive with rpc — no unref */
  }
}

export function stopCronScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = undefined
  }
  ticking = false
}
