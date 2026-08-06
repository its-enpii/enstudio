import { PROMPT_HISTORY_KEY, PROMPT_HISTORY_MAX } from './constants'

export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function saveHistory(history: string[]): void {
  try {
    const trimmed = history.slice(-PROMPT_HISTORY_MAX)
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(trimmed))
  } catch { /* localStorage unavailable */ }
}

export function pushHistory(history: string[], text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return history
  const filtered = history.filter((entry) => entry !== trimmed)
  filtered.push(trimmed)
  if (filtered.length > PROMPT_HISTORY_MAX) filtered.splice(0, filtered.length - PROMPT_HISTORY_MAX)
  saveHistory(filtered)
  return filtered
}

export function caretLineInfo(value: string, pos: number): { line: number; lines: number } {
  const before = value.slice(0, pos)
  const line = before.split('\n').length - 1
  const lines = value.length === 0 ? 1 : value.split('\n').length
  return { line, lines }
}

export function canBrowseHistory(value: string, pos: number, historyIndex: number, key: 'ArrowUp' | 'ArrowDown'): boolean {
  if (historyIndex >= 0) return true
  if (!value.trim()) return key === 'ArrowUp' || key === 'ArrowDown'
  const { line, lines } = caretLineInfo(value, pos)
  if (key === 'ArrowUp') return line <= 0
  return line >= lines - 1
}
