export type VendorProviderOverride = {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export type TerminalCreateParams = {
  projectId?: string
  purpose?: 'terminal' | 'vendor'
  cwd?: string
  cols?: number
  rows?: number
  /** Optional program to run instead of the login shell (vendor CLI host). */
  command?: string
  args?: string[]
  /** Inject Settings baseUrl/model/apiKey into an explicitly launched vendor CLI. */
  injectProvider?: boolean
  /** Per-launch override (vendor config modal). Falls back to Settings file/env. */
  provider?: VendorProviderOverride
}

export type TerminalCreateResult = {
  id: string
  shell: string
  cwd: string
  command: string
  args: string[]
}

export type TerminalDataEvent = {
  id: string
  sequence: number
  projectId?: string
  purpose: 'terminal' | 'vendor'
  data: string
}

export type TerminalExitEvent = {
  id: string
  sequence: number
  projectId?: string
  purpose: 'terminal' | 'vendor'
  exitCode: number
  signal?: number
}

export type TerminalShellMarker = {
  event: 'prompt_ready' | 'command_start' | 'command_end' | 'integration_error'
  payload: Record<string, unknown>
}

export type TerminalShellMarkerEvent = {
  id: string
  sequence: number
  projectId?: string
  purpose: 'terminal' | 'vendor'
  marker: TerminalShellMarker
}

export type TerminalHostEvent =
  | ({ type: 'data' } & TerminalDataEvent)
  | ({ type: 'exit' } & TerminalExitEvent)
  | ({ type: 'shell_marker' } & TerminalShellMarkerEvent)

export type TerminalSessionSnapshot = TerminalCreateResult & {
  projectId?: string
  purpose: 'terminal' | 'vendor'
  createdAt: string
  status: 'running' | 'exited'
  exitCode?: number
  signal?: number
  lastSequence: number
  acknowledgedSequence: number
}

export type TerminalSubscriptionSnapshot = {
  session: TerminalSessionSnapshot
  events: TerminalHostEvent[]
  truncatedBeforeSequence?: number
}

export type TerminalBroadcast =
  | { channel: 'terminal:data'; payload: TerminalDataEvent }
  | { channel: 'terminal:exit'; payload: TerminalExitEvent }
  | { channel: 'terminal:shellMarker'; payload: TerminalShellMarkerEvent }

export type TerminalBroadcastHandler = (event: TerminalBroadcast) => void

export type VendorProviderInjector = (
  command: string,
  cwd: string,
  args: string[],
  override?: VendorProviderOverride,
) => { env: Record<string, string>; args: string[] }
