/**
 * Durable in-loop task board (project-scoped).
 * Not OpenHarness background process manager — tracking board for multi-step agent work.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectHash } from './persist.js'

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface BoardTask {
  id: string
  title: string
  detail?: string
  status: TaskStatus
  /** Task ids that must complete before this one can start (soft deps). */
  blockedBy: string[]
  createdAt: string
  updatedAt: string
  /** Optional free-form note (progress). */
  note?: string
  /** 0–100 optional progress. */
  progress?: number
  subject?: string
  activeForm?: string
}

interface BoardFile {
  version: 1
  projectRoot: string
  updatedAt: string
  tasks: BoardTask[]
}

const MAX_TASKS = 200
const MAX_TITLE = 200
const MAX_DETAIL = 2000
const MAX_NOTE = 500

function home(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function boardPath(projectRoot: string): string {
  return path.join(home(), 'projects', projectHash(projectRoot), 'tasks.json')
}

function now(): string {
  return new Date().toISOString()
}

function slugId(): string {
  return crypto.randomBytes(4).toString('hex')
}

function ensureBoard(projectRoot: string): BoardFile {
  const file = boardPath(projectRoot)
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw) as BoardFile
    if (data?.version === 1 && Array.isArray(data.tasks)) {
      return {
        version: 1,
        projectRoot: path.resolve(projectRoot),
        updatedAt: data.updatedAt || now(),
        tasks: data.tasks.slice(0, MAX_TASKS),
      }
    }
  } catch {
    /* fresh */
  }
  return {
    version: 1,
    projectRoot: path.resolve(projectRoot),
    updatedAt: now(),
    tasks: [],
  }
}

function saveBoard(projectRoot: string, board: BoardFile): void {
  const file = boardPath(projectRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  board.updatedAt = now()
  board.projectRoot = path.resolve(projectRoot)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function parseStatus(v: unknown): TaskStatus | undefined {
  if (v === 'pending' || v === 'in_progress' || v === 'completed' || v === 'cancelled') return v
  // aliases
  if (v === 'running') return 'in_progress'
  if (v === 'done') return 'completed'
  if (v === 'stopped' || v === 'deleted') return 'cancelled'
  return undefined
}

function formatTask(t: BoardTask): string {
  const bits = [`#${t.id}`, t.status, t.title]
  if (typeof t.progress === 'number') bits.push(`${t.progress}%`)
  if (t.blockedBy.length) bits.push(`blockedBy=[${t.blockedBy.join(',')}]`)
  if (t.note) bits.push(`note=${t.note}`)
  if (t.detail) bits.push(`— ${t.detail.slice(0, 120)}`)
  return bits.join(' ')
}

export function taskCreate(
  projectRoot: string,
  input: {
    title?: string
    subject?: string
    detail?: string
    description?: string
    status?: string
    blockedBy?: string[]
    activeForm?: string
  },
): { ok: true; task: BoardTask; content: string } | { ok: false; content: string } {
  const title = (input.title ?? input.subject ?? '').trim().slice(0, MAX_TITLE)
  if (!title) return { ok: false, content: 'task_create requires title (or subject)' }
  const board = ensureBoard(projectRoot)
  if (board.tasks.length >= MAX_TASKS) {
    return { ok: false, content: `task board full (max ${MAX_TASKS}); cancel or complete old tasks` }
  }
  const status = parseStatus(input.status) ?? 'pending'
  const detail = (input.detail ?? input.description)?.trim().slice(0, MAX_DETAIL) || undefined
  const blockedBy = Array.isArray(input.blockedBy)
    ? [...new Set(input.blockedBy.map(String).filter(Boolean))].slice(0, 20)
    : []
  const ts = now()
  const task: BoardTask = {
    id: slugId(),
    title,
    detail,
    status,
    blockedBy,
    createdAt: ts,
    updatedAt: ts,
    activeForm: input.activeForm?.trim().slice(0, 120) || undefined,
  }
  board.tasks.push(task)
  saveBoard(projectRoot, board)
  return {
    ok: true,
    task,
    content: `Created task ${formatTask(task)}\n\n${taskListBody(board)}`,
  }
}

export function taskGet(
  projectRoot: string,
  taskId: string,
): { ok: true; task: BoardTask; content: string } | { ok: false; content: string } {
  const id = taskId.trim()
  if (!id) return { ok: false, content: 'task_get requires taskId' }
  const board = ensureBoard(projectRoot)
  const task = board.tasks.find((t) => t.id === id)
  if (!task) return { ok: false, content: `No task found with ID: ${id}` }
  return { ok: true, task, content: JSON.stringify(task, null, 2) }
}

function taskListBody(board: BoardFile, status?: TaskStatus): string {
  let tasks = board.tasks
  if (status) tasks = tasks.filter((t) => t.status === status)
  if (!tasks.length) return status ? `(no tasks with status ${status})` : '(no tasks)'
  const open = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length
  const lines = [
    `Task board (${tasks.length} shown, ${open} open / ${board.tasks.length} total)`,
    ...tasks.map((t) => formatTask(t)),
  ]
  return lines.join('\n')
}

export function taskList(
  projectRoot: string,
  opts?: { status?: string },
): { ok: true; tasks: BoardTask[]; content: string } {
  const board = ensureBoard(projectRoot)
  const status = opts?.status ? parseStatus(opts.status) : undefined
  const tasks = status ? board.tasks.filter((t) => t.status === status) : board.tasks
  return { ok: true, tasks, content: taskListBody(board, status) }
}

export function taskUpdate(
  projectRoot: string,
  input: {
    taskId?: string
    id?: string
    title?: string
    subject?: string
    detail?: string
    description?: string
    status?: string
    note?: string
    progress?: number
    addBlockedBy?: string[]
    /** Remove specific blocking task ids (handoff unblock). */
    removeBlockedBy?: string[]
    /** Drop all blockers. */
    clearBlockedBy?: boolean
    activeForm?: string
  },
): { ok: true; task: BoardTask; content: string; unblocked?: string[] } | { ok: false; content: string } {
  const id = (input.taskId ?? input.id ?? '').trim()
  if (!id) return { ok: false, content: 'task_update requires taskId' }
  const board = ensureBoard(projectRoot)
  const idx = board.tasks.findIndex((t) => t.id === id)
  if (idx < 0) return { ok: false, content: `No task found with ID: ${id}` }
  const prev = board.tasks[idx]!
  const task = { ...prev }
  if (input.title != null || input.subject != null) {
    const title = (input.title ?? input.subject ?? '').trim().slice(0, MAX_TITLE)
    if (title) task.title = title
  }
  if (input.detail != null || input.description != null) {
    const d = (input.detail ?? input.description ?? '').trim().slice(0, MAX_DETAIL)
    task.detail = d || undefined
  }
  if (input.status != null) {
    const st = parseStatus(input.status)
    if (!st) return { ok: false, content: 'status must be pending|in_progress|completed|cancelled' }
    task.status = st
  }
  if (input.note != null) {
    const n = String(input.note).trim().slice(0, MAX_NOTE)
    task.note = n || undefined
  }
  if (input.progress != null) {
    const p = Math.floor(Number(input.progress))
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return { ok: false, content: 'progress must be 0–100' }
    }
    task.progress = p
  }
  if (Array.isArray(input.addBlockedBy) && input.addBlockedBy.length) {
    task.blockedBy = [
      ...new Set([...task.blockedBy, ...input.addBlockedBy.map(String).filter(Boolean)]),
    ].slice(0, 20)
  }
  if (Array.isArray(input.removeBlockedBy) && input.removeBlockedBy.length) {
    const drop = new Set(input.removeBlockedBy.map(String).filter(Boolean))
    task.blockedBy = task.blockedBy.filter((bid) => !drop.has(bid))
  }
  if (input.clearBlockedBy === true) {
    task.blockedBy = []
  }
  if (input.activeForm != null) {
    task.activeForm = String(input.activeForm).trim().slice(0, 120) || undefined
  }
  task.updatedAt = now()
  board.tasks[idx] = task

  // Terminal status → drop this id from every other task's blockedBy (soft handoff).
  const becameTerminal =
    (task.status === 'completed' || task.status === 'cancelled') &&
    prev.status !== task.status
  const unblocked: string[] = []
  if (becameTerminal) {
    const ts = now()
    for (let i = 0; i < board.tasks.length; i++) {
      if (i === idx) continue
      const other = board.tasks[i]!
      if (!other.blockedBy.includes(id)) continue
      const nextBlocked = other.blockedBy.filter((bid) => bid !== id)
      board.tasks[i] = { ...other, blockedBy: nextBlocked, updatedAt: ts }
      unblocked.push(other.id)
    }
  }

  saveBoard(projectRoot, board)
  const extra =
    unblocked.length > 0
      ? `\nAuto-unblocked ${unblocked.length} task(s): ${unblocked.map((u) => `#${u}`).join(', ')}`
      : ''
  return {
    ok: true,
    task,
    unblocked: unblocked.length ? unblocked : undefined,
    content: `Updated ${formatTask(task)}${extra}\n\n${taskListBody(board)}`,
  }
}

/** Stop = mark cancelled (durable board; no background process to kill). */
export function taskStop(
  projectRoot: string,
  taskId: string,
): { ok: true; task: BoardTask; content: string; unblocked?: string[] } | { ok: false; content: string } {
  return taskUpdate(projectRoot, { taskId, status: 'cancelled', note: 'stopped' })
}

/** Test helper / wipe. */
export function taskClearBoard(projectRoot: string): void {
  const file = boardPath(projectRoot)
  try {
    fs.unlinkSync(file)
  } catch {
    /* ok */
  }
}
