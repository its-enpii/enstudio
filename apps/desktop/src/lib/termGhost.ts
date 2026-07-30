/**
 * Terminal line mirror + PATH ghost helpers (renderer).
 * Ghost never goes to PTY until accept writes the suffix.
 */

export type LineMirror = {
  buf: string
  /** Sticky suppress until line reset (password). */
  passwordLocked: boolean
}

export function createMirror(): LineMirror {
  return { buf: '', passwordLocked: false }
}

/** Apply outbound onData chunk to mirror. */
export function applyMirrorData(m: LineMirror, data: string): void {
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]!
    const code = ch.charCodeAt(0)
    if (ch === '\r' || ch === '\n') {
      m.buf = ''
      m.passwordLocked = false
      continue
    }
    if (code === 0x7f || ch === '\b') {
      m.buf = m.buf.slice(0, -1)
      continue
    }
    // Ctrl+C / Ctrl+U
    if (code === 3 || code === 21) {
      m.buf = ''
      m.passwordLocked = false
      continue
    }
    // Skip other C0 controls
    if (code < 0x20) continue
    m.buf += ch
  }
}

const PASSWORD_RE = /password|passphrase|\[sudo\].*password/i

/** Inbound PTY data may arm password lock. */
export function notePtyOutput(m: LineMirror, data: string): void {
  if (PASSWORD_RE.test(data.slice(-400))) m.passwordLocked = true
}

/**
 * Command token for PATH complete: first word only, cursor assumed at end.
 * null → no ghost.
 */
export function commandToken(m: LineMirror): string | null {
  if (m.passwordLocked) return null
  const line = m.buf
  if (!line || /\s/.test(line[0]!)) return null
  // Only complete while still on first token (no space yet, or only trailing?)
  // After any whitespace → args, skip.
  if (/\s/.test(line)) return null
  if (/^[\\/]/.test(line) || /^[A-Za-z]:[\\/]/.test(line)) return null
  if (!/^[A-Za-z0-9_./+-]+$/.test(line)) return null
  return line
}

export function shouldShowGhost(opts: {
  altScreen: boolean
  token: string | null
  match: string | null
}): boolean {
  if (opts.altScreen) return false
  if (!opts.token || !opts.match) return false
  return opts.match.length > opts.token.length
}

export function ghostSuffix(token: string, match: string): string {
  if (!match.toLowerCase().startsWith(token.toLowerCase())) return ''
  // Preserve match casing for suffix
  return match.slice(token.length)
}

export function pickBestMatch(matches: string[], token: string): string | null {
  if (!matches.length) return null
  const lower = token.toLowerCase()
  const exactCase = matches.find((m) => m.startsWith(token))
  if (exactCase) return exactCase
  const ci = matches.find((m) => m.toLowerCase().startsWith(lower))
  return ci ?? matches[0]!
}

export function isAltScreen(term: { buffer: { active: { type?: string }; normal?: unknown } }): boolean {
  try {
    const t = term.buffer.active?.type
    if (t === 'alternate') return true
    if (t === 'normal') return false
    // Fallback: active !== normal when both exist
    const normal = term.buffer.normal
    if (normal && term.buffer.active !== normal) return true
  } catch {
    /* ignore */
  }
  return false
}
