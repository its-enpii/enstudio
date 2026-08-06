import type { TerminalShellMarker } from './types'

export type ShellMarkerToken =
  | { type: 'data'; data: string }
  | { type: 'marker'; marker: TerminalShellMarker }

const PREFIX = '\x1b]633;EnStudio;'
const MAX_PENDING_BYTES = 64 * 1024
const MARKER_EVENTS = new Set<TerminalShellMarker['event']>([
  'prompt_ready',
  'command_start',
  'command_end',
  'integration_error',
])

function suffixPrefixLength(value: string): number {
  const max = Math.min(value.length, PREFIX.length - 1)
  for (let length = max; length > 0; length -= 1) {
    if (value.endsWith(PREFIX.slice(0, length))) return length
  }
  return 0
}

function decodePayload(value: string): Record<string, unknown> | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export class ShellMarkerParser {
  private pending = ''

  constructor(private readonly nonce: string) {}

  push(data: string): ShellMarkerToken[] {
    this.pending += data
    const tokens: ShellMarkerToken[] = []

    while (this.pending) {
      const start = this.pending.indexOf(PREFIX)
      if (start < 0) {
        const keep = suffixPrefixLength(this.pending)
        const visible = this.pending.slice(0, this.pending.length - keep)
        if (visible) tokens.push({ type: 'data', data: visible })
        this.pending = this.pending.slice(this.pending.length - keep)
        break
      }
      if (start > 0) {
        tokens.push({ type: 'data', data: this.pending.slice(0, start) })
        this.pending = this.pending.slice(start)
      }

      const end = this.pending.indexOf('\x07', PREFIX.length)
      if (end < 0) {
        if (Buffer.byteLength(this.pending, 'utf8') > MAX_PENDING_BYTES) {
          tokens.push({ type: 'data', data: this.pending })
          this.pending = ''
        }
        break
      }

      const frame = this.pending.slice(0, end + 1)
      const fields = this.pending.slice(PREFIX.length, end).split(';')
      this.pending = this.pending.slice(end + 1)
      const [version, nonce, event, payloadValue] = fields
      const payload = payloadValue ? decodePayload(payloadValue) : {}
      if (
        version !== '1'
        || nonce !== this.nonce
        || !MARKER_EVENTS.has(event as TerminalShellMarker['event'])
        || payload === null
      ) {
        tokens.push({ type: 'data', data: frame })
        continue
      }
      tokens.push({
        type: 'marker',
        marker: { event: event as TerminalShellMarker['event'], payload },
      })
    }

    return tokens
  }
}
