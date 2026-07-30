/**
 * Claude-style allow rules for enpii tools.
 * Examples:
 *   run_shell(npm *)
 *   web_fetch(domain:github.com)
 *   git_status
 *   WebSearch          (alias)
 *   PowerShell(git *)  (alias → run_shell)
 */

export type AllowRule = {
  /** Canonical tool name, or '*' for any tool. */
  tool: string
  /** Glob against subject (command, domain, path). Empty = whole tool. */
  pattern: string
  raw: string
}

/** Map common Claude / casual names → enpii tool ids. */
const TOOL_ALIASES: Record<string, string> = {
  bash: 'run_shell',
  powershell: 'run_shell',
  shell: 'run_shell',
  cmd: 'run_shell',
  webfetch: 'web_fetch',
  websearch: 'web_search',
  fetch: 'web_fetch',
  search: 'web_search',
  write: 'write_file',
  edit: 'edit_file',
  read: 'read_file',
}

export function parseAllowRule(raw: string): AllowRule | null {
  const s = raw.trim()
  if (!s || s.startsWith('#')) return null
  const m = /^([A-Za-z0-9_*]+)(?:\((.*)\))?$/.exec(s)
  if (!m) return null
  const toolRaw = m[1]!.trim()
  const pattern = (m[2] ?? '').trim()
  const lower = toolRaw.toLowerCase()
  const tool = lower === '*' ? '*' : TOOL_ALIASES[lower] ?? lower
  return { tool, pattern, raw: s }
}

export function parseAllowRules(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (!t || t.startsWith('#')) continue
    if (parseAllowRule(t)) out.push(t)
  }
  return [...new Set(out)].slice(0, 200)
}

/** Glob: * = any run of chars; ? = one char. Case-insensitive. */
export function globMatch(pattern: string, value: string): boolean {
  if (!pattern || pattern === '*') return true
  const p = pattern.trim()
  const v = value
  // domain:host → match host (and optional path suffix ignored for host check)
  if (/^domain:\s*/i.test(p)) {
    const hostPat = p.replace(/^domain:\s*/i, '').trim()
    const host = extractHost(v) || v
    return globMatchInner(hostPat, host)
  }
  return globMatchInner(p, v)
}

function globMatchInner(pattern: string, value: string): boolean {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  try {
    return new RegExp(`^${esc}$`, 'i').test(value)
  } catch {
    return value.toLowerCase() === pattern.toLowerCase()
  }
}

function extractHost(urlOrHost: string): string {
  const s = urlOrHost.trim()
  try {
    if (/^https?:\/\//i.test(s)) return new URL(s).hostname
  } catch {
    /* */
  }
  // bare host or host/path
  return s.replace(/^\/\//, '').split('/')[0]!.split('?')[0]!
}

/** Subject string used for pattern match (command, url, path, …). */
export function toolSubject(name: string, argsJson: string): string {
  let args: Record<string, unknown> = {}
  try {
    args = argsJson?.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
  } catch {
    return argsJson?.slice(0, 200) ?? ''
  }
  if (name === 'run_shell') return String(args.command ?? args.cmd ?? '').trim()
  if (name === 'web_fetch') return String(args.url ?? args.href ?? '').trim()
  if (name === 'web_search') return String(args.query ?? args.q ?? '').trim()
  if (
    name === 'write_file' ||
    name === 'edit_file' ||
    name === 'read_file' ||
    name === 'replace_file'
  ) {
    return String(args.path ?? args.file ?? '').trim()
  }
  if (name === 'mcp_call_tool') {
    const server = String(args.server ?? '')
    const tool = String(args.tool ?? args.name ?? '')
    return server && tool ? `${server}/${tool}` : server || tool
  }
  if (name.startsWith('git_')) {
    return String(args.message ?? args.branch ?? args.name ?? args.ref ?? name).trim()
  }
  // fallback: compact json
  try {
    return JSON.stringify(args).slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * True if any allow rule covers this tool call.
 * Bare `tool` allows all subjects; `tool(pat)` needs subject match.
 */
export function isAllowedByRules(
  rules: string[] | undefined,
  toolName: string,
  argsJson: string,
): boolean {
  if (!rules?.length) return false
  const subject = toolSubject(toolName, argsJson)
  const name = toolName.toLowerCase()
  for (const raw of rules) {
    const rule = parseAllowRule(raw)
    if (!rule) continue
    if (rule.tool !== '*' && rule.tool !== name) continue
    if (!rule.pattern) return true
    if (globMatch(rule.pattern, subject)) return true
  }
  return false
}

/** Union + dedupe, project rules appended (both apply). */
export function mergeAllowRules(...lists: (string[] | undefined)[]): string[] | undefined {
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    if (!list) continue
    for (const r of list) {
      const t = r.trim()
      if (!t || seen.has(t)) continue
      if (!parseAllowRule(t)) continue
      seen.add(t)
      out.push(t)
    }
  }
  return out.length ? out.slice(0, 200) : undefined
}
