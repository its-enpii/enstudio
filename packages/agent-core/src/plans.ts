/**
 * Durable execution plans under ~/.enpiistudio/projects/<hash>/plans/.
 * plan_tasks → draft .md; exit_plan_mode → mark latest draft approved.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectHash } from './persist.js'

export type PlanStatus = 'draft' | 'approved' | 'rejected'

export interface PlanStep {
  title: string
  detail?: string
}

export interface SavedPlan {
  id: string
  status: PlanStatus
  title: string
  steps: PlanStep[]
  sessionId?: string
  createdAt: string
  updatedAt: string
  /** Absolute path to the markdown file. */
  path: string
  /** Path relative to ENPII home. */
  relPath: string
  /** Raw markdown file content (incl. frontmatter). Populated by fileToPlan(). */
  raw?: string
}

const MAX_STEPS = 12
const MAX_TITLE = 160
const MAX_DETAIL = 300

function home(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function plansDir(projectRoot: string): string {
  return path.join(home(), 'projects', projectHash(projectRoot), 'plans')
}

function now(): string {
  return new Date().toISOString()
}

function slugId(): string {
  return crypto.randomBytes(4).toString('hex')
}

function sanitizeSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return []
  const out: PlanStep[] = []
  for (const item of raw) {
    const row = item as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title.trim().slice(0, MAX_TITLE) : ''
    if (!title) continue
    const detail =
      typeof row.detail === 'string' ? row.detail.trim().slice(0, MAX_DETAIL) : undefined
    out.push({ title, detail: detail || undefined })
    if (out.length >= MAX_STEPS) break
  }
  return out
}

function renderMarkdown(plan: Omit<SavedPlan, 'path' | 'relPath'>): string {
  const lines = [
    '---',
    `id: ${plan.id}`,
    `status: ${plan.status}`,
    `title: ${JSON.stringify(plan.title)}`,
    `createdAt: ${plan.createdAt}`,
    `updatedAt: ${plan.updatedAt}`,
  ]
  if (plan.sessionId) lines.push(`sessionId: ${JSON.stringify(plan.sessionId)}`)
  lines.push('---', '', `# ${plan.title}`, '')
  plan.steps.forEach((step, i) => {
    const body = step.detail ? ` — ${step.detail}` : ''
    lines.push(`${i + 1}. **${step.title}**${body}`)
  })
  lines.push('')
  return lines.join('\n')
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: raw }
  const block = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\n/, '')
  const meta: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    let v = m[2]!.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      try {
        v = JSON.parse(v.startsWith("'") ? `"${v.slice(1, -1).replace(/"/g, '\\"')}"` : v) as string
      } catch {
        v = v.slice(1, -1)
      }
    }
    meta[m[1]!] = v
  }
  return { meta, body }
}

function stepsFromBody(body: string): PlanStep[] {
  const steps: PlanStep[] = []
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\d+\.\s+\*\*(.+?)\*\*(?:\s+[—–-]\s+(.*))?$/)
    if (!m) continue
    steps.push({ title: m[1]!.trim(), detail: m[2]?.trim() || undefined })
  }
  return steps
}

function fileToPlan(file: string, _projectRoot: string): SavedPlan | null {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    const id = meta.id || path.basename(file, '.md')
    const status: PlanStatus =
      meta.status === 'approved' ? 'approved' : meta.status === 'rejected' ? 'rejected' : 'draft'
    const title = meta.title || 'Plan'
    const steps = stepsFromBody(body)
    const relPath = path.relative(home(), file).split(path.sep).join('/')
    return {
      id,
      status,
      title,
      steps,
      sessionId: meta.sessionId,
      createdAt: meta.createdAt || now(),
      updatedAt: meta.updatedAt || now(),
      path: file,
      relPath,
      raw,
    }
  } catch {
    return null
  }
}

function writePlanFile(projectRoot: string, plan: Omit<SavedPlan, 'path' | 'relPath'>): SavedPlan {
  const dir = plansDir(projectRoot)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${plan.id}.md`)
  const md = renderMarkdown(plan)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, md, 'utf8')
  fs.renameSync(tmp, file)
  const relPath = path.relative(home(), file).split(path.sep).join('/')
  // pointer for quick latest lookup
  const latest = path.join(dir, 'latest.json')
  fs.writeFileSync(
    latest,
    `${JSON.stringify({ id: plan.id, status: plan.status, updatedAt: plan.updatedAt }, null, 2)}\n`,
    'utf8',
  )
  return { ...plan, path: file, relPath, raw: md }
}

/** Persist a draft (or replace same id). Requires ≥2 steps. */
export function savePlan(
  projectRoot: string,
  opts: {
    steps: PlanStep[] | unknown
    title?: string
    sessionId?: string
    /** Reuse id to overwrite. */
    id?: string
    status?: PlanStatus
  },
): { ok: true; plan: SavedPlan } | { ok: false; content: string } {
  const steps = sanitizeSteps(opts.steps)
  if (steps.length < 2) return { ok: false, content: 'plan requires at least 2 titled steps' }
  const ts = now()
  const id = opts.id?.trim() || slugId()
  const title =
    (opts.title?.trim().slice(0, MAX_TITLE) || steps[0]?.title || 'Plan').slice(0, MAX_TITLE)
  let createdAt = ts
  const existingPath = path.join(plansDir(projectRoot), `${id}.md`)
  if (fs.existsSync(existingPath)) {
    const prev = fileToPlan(existingPath, projectRoot)
    if (prev) createdAt = prev.createdAt
  }
  const plan = writePlanFile(projectRoot, {
    id,
    status: opts.status === 'approved' ? 'approved' : 'draft',
    title,
    steps,
    sessionId: opts.sessionId,
    createdAt,
    updatedAt: ts,
  })
  return { ok: true, plan }
}

/** Mark a plan approved (default: latest draft). */
export function approvePlan(
  projectRoot: string,
  planId?: string,
): { ok: true; plan: SavedPlan } | { ok: false; content: string } {
  const target = planId?.trim() ? readPlan(projectRoot, planId) : latestPlan(projectRoot, 'draft') ?? latestPlan(projectRoot)
  if (!target) return { ok: false, content: 'no plan to approve' }
  const plan = writePlanFile(projectRoot, {
    ...target,
    status: 'approved',
    updatedAt: now(),
  })
  return { ok: true, plan }
}

/** Mark a plan rejected (default: latest draft). Does not delete the file. */
export function rejectPlan(
  projectRoot: string,
  planId?: string,
): { ok: true; plan: SavedPlan } | { ok: false; content: string } {
  const target = planId?.trim()
    ? readPlan(projectRoot, planId)
    : latestPlan(projectRoot, 'draft') ?? latestPlan(projectRoot)
  if (!target) return { ok: false, content: 'no plan to reject' }
  const plan = writePlanFile(projectRoot, {
    ...target,
    status: 'rejected',
    updatedAt: now(),
  })
  return { ok: true, plan }
}

/** Short system-prompt block so the model follows the durable plan (anti-halu). */
export function planContextPrompt(projectRoot: string): string {
  const approved = latestPlan(projectRoot, 'approved')
  const draft = latestPlan(projectRoot, 'draft')
  if (!approved && !draft) return ''
  const lines: string[] = ['Active plan on disk (follow this; do not invent a parallel plan):']
  if (approved) {
    lines.push(`APPROVED ${approved.relPath} — ${approved.title}`)
    approved.steps.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ''}`)
    })
  }
  if (draft && draft.id !== approved?.id) {
    lines.push(`DRAFT ${draft.relPath} — ${draft.title} (awaiting user approve/reject; do not execute writes yet if plan mode is on)`)
    draft.steps.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ''}`)
    })
  }
  lines.push(
    'task_create/task_update use board UUIDs from task_list — never plan step ids like task-1.',
  )
  return lines.join('\n')
}

export function readPlan(projectRoot: string, planId: string): SavedPlan | null {
  const id = planId.trim()
  if (!id) return null
  const file = path.join(plansDir(projectRoot), `${id}.md`)
  if (!fs.existsSync(file)) return null
  return fileToPlan(file, projectRoot)
}

export function latestPlan(
  projectRoot: string,
  status?: PlanStatus,
  sessionId?: string,
): SavedPlan | null {
  const dir = plansDir(projectRoot)
  if (!fs.existsSync(dir)) return null
  // Prefer latest.json pointer, then mtime scan.
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8')) as {
      id?: string
    }
    if (pointer.id) {
      const p = readPlan(projectRoot, pointer.id)
      if (p && (!status || p.status === status) && (!sessionId || p.sessionId === sessionId)) return p
    }
  } catch {
    /* scan */
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  for (const file of files) {
    const p = fileToPlan(file, projectRoot)
    if (p && (!status || p.status === status) && (!sessionId || p.sessionId === sessionId)) return p
  }
  return null
}

export function listPlans(projectRoot: string, limit = 20): SavedPlan[] {
  const dir = plansDir(projectRoot)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fileToPlan(path.join(dir, f), projectRoot))
    .filter((p): p is SavedPlan => Boolean(p))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.min(Math.max(limit, 1), 50))
}
