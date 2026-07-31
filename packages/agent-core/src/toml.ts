/**
 * Minimal TOML read/write for enpii config (FR-D3).
 * Supports: strings, bools, ints, string arrays, flat tables.
 * No nested tables, dates, or multiline beyond basic """ blocks.
 */

export type TomlValue = string | number | boolean | string[] | TomlTable | TomlTable[]
export type TomlTable = { [key: string]: TomlValue }

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  return s
}

function parseScalar(raw: string): TomlValue {
  const s = raw.trim()
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (!inner) return []
    // split on commas not inside quotes
    const parts: string[] = []
    let cur = ''
    let q: '"' | "'" | null = null
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]!
      if (q) {
        cur += c
        if (c === q && inner[i - 1] !== '\\') q = null
        continue
      }
      if (c === '"' || c === "'") {
        q = c
        cur += c
        continue
      }
      if (c === ',') {
        parts.push(cur.trim())
        cur = ''
        continue
      }
      cur += c
    }
    if (cur.trim()) parts.push(cur.trim())
    return parts.map((p) => String(unquote(p)))
  }
  return unquote(s)
}

/** Parse a tiny TOML document into a flat+section table. */
export function parseToml(text: string): TomlTable {
  const root: TomlTable = {}
  let table: TomlTable = root
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const section = /^\[([^\]]+)\]$/.exec(trimmed)
    if (section) {
      const name = section[1]!.trim()
      const next: TomlTable = {}
      root[name] = next
      table = next
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = parseScalar(trimmed.slice(eq + 1))
    table[key] = val
  }
  return root
}

function quoteStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function formatValue(v: TomlValue): string {
  if (typeof v === 'string') return quoteStr(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `[${v.map((x) => quoteStr(String(x))).join(', ')}]`
  return '""'
}

/** Serialize a flat table (optional nested one-level sections). */
export function stringifyToml(table: TomlTable): string {
  const lines: string[] = []
  const sections: [string, TomlTable][] = []
  for (const [k, v] of Object.entries(table)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      sections.push([k, v as TomlTable])
      continue
    }
    lines.push(`${k} = ${formatValue(v)}`)
  }
  for (const [name, sec] of sections) {
    if (lines.length) lines.push('')
    lines.push(`[${name}]`)
    for (const [k, v] of Object.entries(sec)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) continue
      lines.push(`${k} = ${formatValue(v as TomlValue)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Pick string field from table (root or provider section). */
export function tomlString(table: TomlTable, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = table[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  const provider = table.provider
  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    for (const key of keys) {
      const v = (provider as TomlTable)[key]
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return undefined
}

export function tomlStringArray(table: TomlTable, key: string): string[] | undefined {
  const v = table[key]
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim())
  const provider = table.provider
  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    const inner = (provider as TomlTable)[key]
    if (Array.isArray(inner)) return inner.map(String).filter((s) => s.trim())
  }
  return undefined
}
