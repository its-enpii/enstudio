/**
 * TerminalHost — thin orchestrator that delegates PTY operations to a
 * dedicated Electron utilityProcess (`terminalWorker.cjs`). We do this
 * because running node-pty inside the main process causes child-process
 * output (cmd.exe, PowerShell) to be silently buffered — likely because
 * the main process is busy with other IPC. The utilityProcess owns a
 * clean console handle and forwards every `onData` chunk promptly.
 */
import { EventJournal } from './eventJournal'
import type {
  TerminalBroadcastHandler,
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalHostEvent,
  TerminalSessionSnapshot,
  TerminalSubscriptionSnapshot,
} from './types'

type Command = {
  type: 'create' | 'write' | 'resize' | 'kill'
  correlationId?: number
  id?: string
  data?: string
  cols?: number
  rows?: number
  payload?: TerminalCreateParams
}

type Reply =
  | { type: 'createReply'; ok: true; correlationId: number; id: string; command: string; args: string[]; cwd: string; shellLabel: string }
  | { type: 'createReply'; ok: false; correlationId: number; error: string }

type Snapshot = {
  id: string
  shell: string
  cwd: string
  command: string
  args: string[]
  projectId?: string
  purpose: 'terminal' | 'vendor'
  createdAt: string
  status: 'running' | 'exited'
  exitCode?: number
  signal?: number
  lastSequence: number
  acknowledgedSequence: number
}

export type TerminalHostOptions = {
  homeDirectory: () => string
  runtimeDirectory: () => string
  defaultShell?: () => string
  broadcast: TerminalBroadcastHandler
  /** Async resolver that returns the path to the compiled worker bundle
   *  (`terminalWorker.cjs`). The host invokes this once at startup. */
  workerBundlePath: () => Promise<string>
  /** Snapshot of the parent's process.env, captured at construction time.
   *  We can't read `process.env` inside the bundled main.cjs because Vite
   *  statically replaces every `process.env.X` access — so the host needs
   *  the live env passed in from the main process before bundling. */
  parentEnv?: NodeJS.ProcessEnv
  eventJournalLimit?: number
}

type PendingReply = {
  resolve: (reply: Reply) => void
  reject: (err: Error) => void
}

export class TerminalHost {
  private readonly sessions = new Map<string, Snapshot>()
  private readonly eventJournalLimit: number
  private readonly pendingReplies = new Map<number, PendingReply>()
  private readonly journals = new Map<string, EventJournal<TerminalHostEvent>>()
  private readonly sequenceById = new Map<string, number>()
  private readonly ackById = new Map<string, number>()
  private nextCorrelationId = 1
  private worker: import('electron').UtilityProcess | null = null
  private workerReady: Promise<void> | null = null

  constructor(private readonly options: TerminalHostOptions) {
    this.eventJournalLimit = options.eventJournalLimit ?? 2_000
  }

  async start(): Promise<void> {
    if (this.worker) return
    this.workerReady = this.bootstrapWorker()
    await this.workerReady
  }

  private async bootstrapWorker(): Promise<void> {
    const { utilityProcess } = await import('electron')
    const modulePath = await this.options.workerBundlePath()
    this.worker = utilityProcess.fork(modulePath, [], {
      serviceName: 'enpii-terminal-worker',
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: process.env.PATH ?? '',
        ComSpec: process.env.ComSpec ?? '',
        PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC',
      },
    })
    this.worker.stdout?.on('data', (chunk: Buffer) => {
      // eslint-disable-next-line no-console
      console.log('[terminalWorker stdout]', chunk.toString('utf8').trimEnd())
    })
    this.worker.stderr?.on('data', (chunk: Buffer) => {
      // eslint-disable-next-line no-console
      console.error('[terminalWorker stderr]', chunk.toString('utf8').trimEnd())
    })
    this.worker.on('message', (raw: unknown) => {
      const message = raw as { type?: string } & Record<string, unknown>
      if (message.type === 'createReply' || message.type === 'initReply') {
        const correlationId = message.correlationId as number
        const pending = this.pendingReplies.get(correlationId)
        if (pending) {
          this.pendingReplies.delete(correlationId)
          pending.resolve(message as unknown as Reply)
        }
        return
      }
      const event = raw as TerminalHostEvent
      if (event && typeof event === 'object' && 'type' in event) {
        const id = (event as { id?: string }).id
        if (id) {
          const journal = this.journals.get(id)
          if (journal) journal.append(event)
          const lastSeq = this.sequenceById.get(id) ?? 0
          if ((event as { sequence?: number }).sequence ?? 0 > lastSeq) {
            this.sequenceById.set(id, (event as { sequence: number }).sequence)
          }
          // Keep the public snapshot's `lastSequence` in sync — the renderer
          // compares against this when acknowledging.
          const snapshot = this.sessions.get(id)
          if (snapshot && typeof (event as { sequence?: number }).sequence === 'number') {
            const seq = (event as { sequence: number }).sequence
            if (seq > snapshot.lastSequence) snapshot.lastSequence = seq
          }
        }
        if ((event as { type: string }).type === 'exit') {
          const id = (event as { id: string }).id
          const snapshot = this.sessions.get(id)
          if (snapshot) {
            snapshot.status = 'exited'
            snapshot.exitCode = (event as { exitCode?: number }).exitCode
            snapshot.signal = (event as { signal?: number }).signal
          }
        }
        this.options.broadcast({ channel: `terminal:${(event as { type: string }).type === 'shell_marker' ? 'shellMarker' : (event as { type: string }).type === 'data' ? 'data' : (event as { type: string }).type === 'exit' ? 'exit' : 'data'}`, payload: event })
      }
    })
    this.worker.on('exit', (code) => {
      // eslint-disable-next-line no-console
      console.error('[terminalHost] worker exited', code)
      const error = new Error('terminal worker process exited')
      for (const [, pending] of this.pendingReplies) pending.reject(error)
      this.pendingReplies.clear()
      this.worker = null
    })
    // Forward the parent's env (PATH/ComSpec) to the worker. utilityProcess
    // strips process.env on fork, and on Windows our launcher (pnpm → node →
    // electron) never inherits the user PATH to begin with, so the worker
    // would otherwise spawn cmd.exe with empty PATH and every external
    // command (docker, npm, git, …) would fail with "is not recognized".
    // Block on the init acknowledgement so create() cannot race ahead.
    await new Promise<void>((resolve, reject) => {
      const correlationId = this.nextCorrelationId++
      const onMessage = (raw: unknown): void => {
        const message = raw as { type?: string; correlationId?: number }
        if (message.type === 'initReply' && message.correlationId === correlationId) {
          this.worker?.off('message', onMessage)
          resolve()
        }
      }
      this.worker?.on('message', onMessage)
      const liveEnv = this.options.parentEnv ?? ({} as NodeJS.ProcessEnv)
      const envObj = Object.fromEntries(
        Object.entries(liveEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      // eslint-disable-next-line no-console
      console.log('[terminalHost] posting init with', Object.keys(envObj).length, 'env keys, PATH chars:', envObj.PATH?.length, 'has docker:', envObj.PATH?.toLowerCase().includes('docker'))
      this.worker?.postMessage({
        type: 'init',
        correlationId,
        env: envObj,
      })
      setTimeout(() => {
        this.worker?.off('message', onMessage)
        reject(new Error('terminal worker init timed out'))
      }, 5_000)
    })
  }

  private sendCommand<T extends Reply = Reply>(command: Omit<Command, 'correlationId'>): Promise<T> {
    if (!this.worker) throw new Error('terminal worker not started')
    const correlationId = this.nextCorrelationId++
    return new Promise<T>((resolve, reject) => {
      this.pendingReplies.set(correlationId, { resolve: (r) => resolve(r as T), reject })
      this.worker!.postMessage({ ...command, correlationId })
    })
  }

  async create(params?: TerminalCreateParams): Promise<TerminalCreateResult> {
    await this.start()
    const reply = await this.sendCommand({ type: 'create', payload: params })
    if (!reply.ok) throw new Error(reply.error)
    const snapshot: Snapshot = {
      id: reply.id,
      shell: reply.shellLabel,
      cwd: reply.cwd,
      command: reply.command,
      args: [...reply.args],
      projectId: params?.projectId?.trim() || undefined,
      purpose: params?.purpose === 'vendor' ? 'vendor' : 'terminal',
      createdAt: new Date().toISOString(),
      status: 'running',
      lastSequence: 0,
      acknowledgedSequence: 0,
    }
    this.sessions.set(reply.id, snapshot)
    this.sequenceById.set(reply.id, 0)
    this.ackById.set(reply.id, 0)
    this.journals.set(reply.id, new EventJournal<TerminalHostEvent>(this.eventJournalLimit))
    return {
      id: reply.id,
      shell: reply.shellLabel,
      cwd: reply.cwd,
      command: reply.command,
      args: [...reply.args],
    }
  }

  write(idValue: unknown, dataValue: unknown): void {
    if (!this.worker) return
    const id = typeof idValue === 'string' ? idValue : ''
    if (!id) return
    const data = typeof dataValue === 'string' ? dataValue : String(dataValue ?? '')
    this.worker.postMessage({ type: 'write', id, data })
  }

  resize(idValue: unknown, colsValue: unknown, rowsValue: unknown): void {
    if (!this.worker) return
    const id = typeof idValue === 'string' ? idValue : ''
    const cols = typeof colsValue === 'number' ? colsValue : 80
    const rows = typeof rowsValue === 'number' ? rowsValue : 24
    this.worker.postMessage({ type: 'resize', id, cols, rows })
  }

  kill(idValue: unknown): void {
    if (!this.worker) return
    const id = typeof idValue === 'string' ? idValue : ''
    if (!id) return
    this.worker.postMessage({ type: 'kill', id })
    this.sessions.delete(id)
    this.journals.delete(id)
    this.sequenceById.delete(id)
    this.ackById.delete(id)
  }

  list(projectIdValue?: unknown, purposeValue?: unknown): TerminalSessionSnapshot[] {
    const projectId = typeof projectIdValue === 'string' && projectIdValue.trim() ? projectIdValue.trim() : undefined
    const purpose = purposeValue === 'vendor' ? 'vendor' : purposeValue === 'terminal' ? 'terminal' : undefined
    return [...this.sessions.values()]
      .filter((session) => projectId === undefined || session.projectId === projectId)
      .filter((session) => purpose === undefined || session.purpose === purpose)
  }

  subscribe(idValue: unknown, afterSequenceValue?: unknown): TerminalSubscriptionSnapshot {
    const id = typeof idValue === 'string' ? idValue : ''
    const session = this.sessions.get(id)
    if (!session) throw new Error(`terminal session not found: ${id}`)
    const afterSequence = typeof afterSequenceValue === 'number' && Number.isFinite(afterSequenceValue)
      ? Math.max(0, Math.trunc(afterSequenceValue))
      : 0
    const replay = this.journals.get(id)?.replay(afterSequence) ?? { events: [], truncatedBeforeSequence: undefined }
    return { session: this.toSnapshot(session), ...replay }
  }

  acknowledge(idValue: unknown, sequenceValue: unknown): void {
    const id = typeof idValue === 'string' ? idValue : ''
    const sequence = typeof sequenceValue === 'number' && Number.isFinite(sequenceValue) ? Math.max(0, Math.trunc(sequenceValue)) : 0
    const snapshot = this.sessions.get(id)
    if (!snapshot) throw new Error(`terminal session not found: ${id}`)
    if (sequence > snapshot.lastSequence) throw new Error('terminal acknowledgement exceeds latest sequence')
    snapshot.acknowledgedSequence = Math.max(snapshot.acknowledgedSequence, sequence)
  }

  killAll(): void {
    const ids = [...this.sessions.keys()]
    for (const id of ids) this.kill(id)
  }

  size(): number {
    return this.sessions.size
  }

  private toSnapshot(session: Snapshot): TerminalSessionSnapshot {
    return { ...session }
  }
}
