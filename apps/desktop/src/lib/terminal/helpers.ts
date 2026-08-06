import type { CommandState } from './types'

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function markerString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value ? value : undefined
}

export function markerNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function stripAnsi(text: string): string {
  if (!text) return ''
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b[=>]/g, '')
}

const SHELL_PROMPT_RE = /(?:^|\r?\n)\s*(?:\([^)]+\)\s*)?(?:\[[^\]]+\]|[\w.-]+@[\w.-]+[:\s][^\r\n]*|PS\s+[A-Za-z]:[\\\/][^\r\n]*|[A-Za-z]:[\\\/][^\r\n]*|[\w.-]+:[^\r\n]*|[\w.-]+)?\s*[$#%>]\s*$/m

export function looksLikeShellPrompt(output: string): boolean {
  if (!output) return false
  const clean = stripAnsi(output).trimEnd()
  const tail = clean.slice(-400)
  return SHELL_PROMPT_RE.test(tail)
}

export function finalizeOutput(existing: string, liveBuffer: string): string {
  return (existing ?? '') + liveBuffer
}

export function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || durationMs < 0) return ''
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function formatIdleSince(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp)
  if (delta < 1500) return 'just now'
  const seconds = Math.round(delta / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  return remSec ? `${minutes}m ${remSec}s ago` : `${minutes}m ago`
}

export function stateLabel(state: CommandState, exitCode?: number): string {
  if (state === 'running') return 'running'
  if (state === 'success') return `exit ${exitCode ?? 0}`
  if (state === 'failed') return `exit ${exitCode ?? 1}`
  if (state === 'exited') return `shell exited ${exitCode ?? ''}`.trim()
  if (state === 'integration_error') return 'classic mode'
  return 'ready'
}

export function stateClasses(state: CommandState): string {
  if (state === 'running') return 'text-studio-gold'
  if (state === 'failed' || state === 'integration_error') return 'text-studio-error'
  if (state === 'success') return 'text-studio-success'
  if (state === 'exited') return 'text-studio-text-dim'
  return 'text-studio-text-dim'
}

export function blockStatusClass(state: CommandState): string {
  if (state === 'running') return 'border-studio-gold/40 bg-studio-gold/10'
  if (state === 'failed' || state === 'integration_error') return 'border-studio-error/40 bg-studio-error/8'
  if (state === 'success') return 'border-studio-success/35 bg-studio-success/8'
  if (state === 'exited') return 'border-border-subtle bg-white/4'
  return 'border-border-subtle bg-white/4'
}

export function blockLeftAccent(state: CommandState): string {
  if (state === 'running') return 'border-l-studio-gold'
  if (state === 'failed' || state === 'integration_error') return 'border-l-studio-error'
  if (state === 'success') return 'border-l-studio-success'
  if (state === 'exited') return 'border-l-studio-text-dim/40'
  return 'border-l-studio-purple/40'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function outputPreview(text: string, max = 10000, echoedCommand?: string): string {
  if (!text) return ''
  let cleaned = text
    // CSI escape sequences (colors, cursor movement, etc.)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // OSC escape sequences
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\][^\r\n]*$/gm, '')
    // G0/G1 charset selects & simple escape codes
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '')
    .replace(/[^\n]\x08/g, '')

  cleaned = cleaned.replace(/[ \t]+$/gm, '')

  if (echoedCommand) {
    const echoRe = new RegExp(`^\\s*${escapeRegExp(echoedCommand).replace(/\r?\n/g, '\\n')}\\s*\\n`)
    cleaned = cleaned.replace(echoRe, '')
  }

  // Remove trailing shell prompt lines
  cleaned = cleaned.replace(/(?:\r?\n|^)\s*(?:\([^)]+\)\s*)?(?:\[[^\]]+\]|[\w.-]+@[\w.-]+[:\s][^\r\n]*|PS\s+[A-Za-z]:[\\\/][^\r\n]*|[A-Za-z]:[\\\/][^\r\n]*|[\w.-]+:[^\r\n]*|[\w.-]+)?\s*[$#%>][\s\S]*$/g, '')

  cleaned = cleaned.trim()
  return cleaned.length > max ? `${cleaned.slice(0, max)}\u2026` : cleaned
}

export function detectStreamFollow(command: string): boolean {
  const trimmed = command.trim().toLowerCase()
  if (!trimmed) return false
  if (/\btail\b[^&|;\n]*\s-f\b/.test(trimmed)) return true
  if (/\b(less|more)\b\s\+F/.test(trimmed)) return true
  // Docker logs, docker compose logs (-f or normal stream)
  if (/\bdocker(\.\w+)?\s+(compose\s+)?logs?\b/.test(trimmed)) return true
  const watchPatterns = [
    /\bng\s+serve\b/,
    /\bvite\b/,
    /\bnext\s+dev\b/,
    /\bnpm\s+run\s+(dev|watch|start|serve)\b/,
    /\byarn\s+(dev|start|run\s+(dev|watch|start|serve))\b/,
    /\bpnpm\s+(dev|start|run\s+(dev|watch|start|serve))\b/,
    /\bnode\s+--watch\b/,
    /\bnodemon\b/,
    /\bphp\s+artisan\s+serve\b/,
    /\brails\s+s\b/,
    /\bdjango[-\w]*\s+runserver\b/,
    /\bflask\s+run\b/,
    /\buvicorn\b/,
    /\bgunicorn\b/,
  ]
  for (const re of watchPatterns) {
    if (re.test(trimmed)) return true
  }
  return false
}

export function pathTitle(cwd: string, fallback: number): string {
  const normalized = cwd.replace(/[\\\/]+$/, '')
  return normalized.split(/[\\\/]/).filter(Boolean).at(-1) || `Terminal ${fallback}`
}
