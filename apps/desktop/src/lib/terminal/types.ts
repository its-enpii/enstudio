export type CommandState = 'ready' | 'running' | 'success' | 'failed' | 'exited' | 'integration_error'

export type CommandBlock = {
  id: string
  sessionId: string
  command: string
  cwd: string
  shell: string
  state: CommandState
  exitCode?: number
  durationMs?: number
  startedAt: number
  finishedAt?: number
  output: string
  isLiveSurface: boolean
  isStreamFollow?: boolean
  message?: string
}

export type TerminalTab = {
  id: string
  title: string
  cwd: string
  shell: string
  exited: boolean
  blocks: CommandBlock[]
  runningCommandId: string | null
  history: string[]
  historyIndex: number
  historyDraft: string
  composer: string
}

export type TerminalApi = {
  create: (
    cwd: string,
    cols: number,
    rows: number,
    opts?: { projectId?: string; purpose?: 'terminal' | 'vendor'; command?: string; args?: string[]; injectProvider?: boolean; provider?: unknown },
  ) => Promise<{ id: string; shell: string; cwd: string; command: string; args: string[] }>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  list: (projectId?: string, purpose?: 'terminal' | 'vendor') => Promise<Array<{ id: string; shell: string; cwd: string; command: string; args: string[]; status: string }>>
  subscribe: (id: string, afterSequence?: number) => Promise<{ session: { cwd: string; shell: string; status: string }; events: Array<import('../../../../electron/terminal/types').TerminalHostEvent>; truncatedBeforeSequence?: number }>
  acknowledge: (id: string, sequence: number) => Promise<void>
  pathComplete?: (prefix: string) => Promise<string[]>
  onData: (handler: (payload: { id: string; sequence: number; purpose: string; data: string }) => void) => () => void
  onExit: (handler: (payload: { id: string; sequence: number; purpose: string; exitCode: number }) => void) => () => void
  onShellMarker: (handler: (payload: { id: string; sequence: number; purpose: string; marker: { event: string; payload: Record<string, unknown> } }) => void) => () => void
}
