import fs from 'node:fs'
import path from 'node:path'

export const TERMINAL_DEFAULT_COLS = 80
export const TERMINAL_DEFAULT_ROWS = 24
export const TERMINAL_MIN_COLS = 2
export const TERMINAL_MIN_ROWS = 1
export const TERMINAL_MAX_COLS = 1_000
export const TERMINAL_MAX_ROWS = 1_000
export const TERMINAL_MAX_WRITE_BYTES = 1024 * 1024

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

export function clampTerminalCols(value: unknown, fallback = TERMINAL_DEFAULT_COLS): number {
  return Math.min(TERMINAL_MAX_COLS, Math.max(TERMINAL_MIN_COLS, finiteInteger(value, fallback)))
}

export function clampTerminalRows(value: unknown, fallback = TERMINAL_DEFAULT_ROWS): number {
  return Math.min(TERMINAL_MAX_ROWS, Math.max(TERMINAL_MIN_ROWS, finiteInteger(value, fallback)))
}

export function validateTerminalCwd(value: unknown, fallback: string): string {
  const cwd = path.resolve(typeof value === 'string' && value.trim() ? value : fallback)
  let stat: fs.Stats
  try {
    stat = fs.statSync(cwd)
  } catch {
    throw new Error(`terminal cwd not found: ${cwd}`)
  }
  if (!stat.isDirectory()) throw new Error(`terminal cwd is not a directory: ${cwd}`)
  return cwd
}

export function normalizeTerminalArgs(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('terminal args must be an array')
  return value.map((arg) => String(arg))
}

export function normalizeTerminalWrite(value: unknown): string {
  if (typeof value !== 'string') throw new Error('terminal data must be a string')
  if (Buffer.byteLength(value, 'utf8') > TERMINAL_MAX_WRITE_BYTES) {
    throw new Error(`terminal data exceeds ${TERMINAL_MAX_WRITE_BYTES} bytes`)
  }
  return value
}

export function normalizeTerminalId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('terminal id is required')
  return value
}
