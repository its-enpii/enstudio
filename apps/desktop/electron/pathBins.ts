/**
 * Scan PATH for command basenames. Cached in main process.
 */
import fs from 'node:fs'
import path from 'node:path'

const CACHE_TTL_MS = 5 * 60_000
const WIN_EXTS = new Set(['.exe', '.cmd', '.bat', '.com', '.ps1'])

let cache: { at: number; bins: string[] } | null = null

function pathDirs(): string[] {
  const raw = process.env.Path ?? process.env.PATH ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const out: string[] = []
  for (const part of raw.split(sep)) {
    const d = part.trim().replace(/^"(.*)"$/, '$1')
    if (d) out.push(d)
  }
  return out
}

function bareName(file: string, win: boolean): string | null {
  if (win) {
    const ext = path.extname(file).toLowerCase()
    if (ext && !WIN_EXTS.has(ext)) return null
    const base = ext ? file.slice(0, -ext.length) : file
    if (!base || base === '.' || base === '..') return null
    return base
  }
  if (file.startsWith('.')) return null
  return file
}

function scan(): string[] {
  const win = process.platform === 'win32'
  const seen = new Map<string, string>()
  for (const dir of pathDirs()) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const file of entries) {
      const bare = bareName(file, win)
      if (!bare) continue
      const key = win ? bare.toLowerCase() : bare
      if (!seen.has(key)) seen.set(key, bare)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function listPathBins(force = false): string[] {
  const now = Date.now()
  if (!force && cache && now - cache.at < CACHE_TTL_MS) return cache.bins
  const bins = scan()
  cache = { at: now, bins }
  return bins
}

/** Prefix filter. Max 25. Only matches longer than prefix (real suffix for ghost). */
export function pathComplete(prefix: string, limit = 25): string[] {
  const p = String(prefix ?? '').trim()
  if (!p) return []
  const win = process.platform === 'win32'
  const needle = win ? p.toLowerCase() : p
  const out: string[] = []
  for (const b of listPathBins()) {
    const hay = win ? b.toLowerCase() : b
    if (!hay.startsWith(needle)) continue
    if (b.length <= p.length) continue
    out.push(b)
    if (out.length >= limit) break
  }
  return out
}
