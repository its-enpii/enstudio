/**
 * terminalWorker — runs in an Electron utilityProcess so node-pty has a
 * clean console handle independent from the main process. node-pty inside
 * Electron's main process buffers child-process output (WinPTY and ConPTY
 * both lose chunks on Windows when the main process is busy handling IPC).
 * Running it in a dedicated utilityProcess fixes the buffering.
 *
 * Wire protocol (parent ⇄ worker):
 *   parent → worker: { type: 'create', id, payload }, { type: 'write', id, data },
 *                       { type: 'resize', id, cols, rows }, { type: 'kill', id }
 *   worker → parent: { type: 'data', id, sequence, data },
 *                       { type: 'exit', id, exitCode, signal },
 *                       { type: 'shellMarker', id, sequence, marker }
 */
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ShellMarkerParser } from './shellMarkerParser'
import type { TerminalCreateParams, TerminalHostEvent, TerminalShellMarker } from './types'
import {
  clampTerminalCols,
  clampTerminalRows,
  normalizeTerminalArgs,
  normalizeTerminalId,
  normalizeTerminalWrite,
  validateTerminalCwd,
} from './validation'

type Session = {
  id: string
  pty: pty.IPty
  cwd: string
  command: string
  args: string[]
  projectId?: string
  purpose: 'terminal' | 'vendor'
  sequence: number
  commandActive?: {
    command: string
    startedAt: number
    hardTimer: NodeJS.Timeout
    idleTimer?: NodeJS.Timeout
    lastExitCode?: number
  }
  markerParser?: ShellMarkerParser
}

const HARD_TIMEOUT_MS = 30_000
const IDLE_MS = 800
const LASTEXITCODE_REGEX = /(?:\r?\n|^)\$LASTEXITCODE\s*(?:=|:\s*|=)\s*(-?\d+)/i

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

const sessions = new Map<string, Session>()
let nextWorkerId = 0
// Electron's utilityProcess strips parent process.env on fork, so we have
// no PATH/ComSpec here. The host posts the env it bootstrapped (including
// the Windows user PATH read from the registry) right after the worker
// starts so PTY shells can resolve executables. We seed with sensible
// defaults so the first PTY session — which can race the init message —
// still has Windows essentials available.
let inheritedEnv: NodeJS.ProcessEnv = process.platform === 'win32'
  ? {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC',
    }
  : { TERM: 'xterm-256color', COLORTERM: 'truecolor' }

function nextSequence(session: Session): number {
  session.sequence += 1
  return session.sequence
}

function send(event: TerminalHostEvent): void {
  // eslint-disable-next-line no-console
  console.log(`[terminalWorker] send ${event.type} ${event.sequence} ${'data' in event ? (event.data as string).length + 'b' : ''}`)
  process.parentPort?.postMessage(event)
}

function sendData(session: Session, data: string): void {
  if (!data) return
  // eslint-disable-next-line no-console
  console.log(`[terminalWorker data ${session.id}] ${JSON.stringify(data.slice(0, 400))}`)
  send({
    type: 'data',
    id: session.id,
    sequence: nextSequence(session),
    projectId: session.projectId,
    purpose: session.purpose,
    data,
  })
}

function sendShellMarker(session: Session, marker: TerminalShellMarker): void {
  if (marker.event === 'command_start') {
    const startedAt = Date.now()
    const cwd = (marker.payload?.cwd as string | undefined) ?? session.cwd
    const hardTimer = setTimeout(() => {
      if (session.commandActive?.startedAt !== startedAt) return
      const exitCode = session.commandActive?.lastExitCode ?? 130
      session.commandActive = undefined
      sendShellMarker(session, {
        event: 'command_end',
        payload: { cwd, exitCode, durationMs: Date.now() - startedAt, reason: 'hard_timeout' },
      })
    }, HARD_TIMEOUT_MS)
    session.commandActive = {
      command: (marker.payload?.command as string | undefined) ?? '',
      startedAt,
      hardTimer,
    }
  } else if (marker.event === 'command_end') {
    if (session.commandActive) {
      clearTimeout(session.commandActive.hardTimer)
      if (session.commandActive.idleTimer) clearTimeout(session.commandActive.idleTimer)
      session.commandActive = undefined
    }
  }
  send({
    type: 'shell_marker',
    id: session.id,
    sequence: nextSequence(session),
    projectId: session.projectId,
    purpose: session.purpose,
    marker,
  })
}

function onCommandActivity(session: Session, data: string): void {
  const active = session.commandActive
  if (!active) return
  const match = data.match(LASTEXITCODE_REGEX)
  if (match) {
    const value = Number(match[1])
    if (Number.isFinite(value)) active.lastExitCode = value
  }
  if (active.idleTimer) clearTimeout(active.idleTimer)
  const startedAt = active.startedAt
  const cwd = session.cwd
  active.idleTimer = setTimeout(() => {
    if (session.commandActive?.startedAt !== startedAt) return
    const exitCode = session.commandActive?.lastExitCode ?? 0
    session.commandActive = undefined
    sendShellMarker(session, {
      event: 'command_end',
      payload: { cwd, exitCode, durationMs: Date.now() - startedAt, reason: 'idle' },
    })
  }, IDLE_MS)
}

function resolveExecutablePath(command: string, envPath?: string): string {
  if (!command) return defaultShell()
  if (fs.existsSync(command)) return command

  const isWin = process.platform === 'win32'
  const extensions = isWin ? ['.exe', '.cmd', '.bat', ''] : ['']

  if (isWin) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      if (fs.existsSync(`${command}${ext}`)) return `${command}${ext}`
    }
  }

  const pathDirs = (envPath || process.env.PATH || '')
    .split(isWin ? ';' : ':')
    .filter(Boolean)

  if (isWin) {
    pathDirs.push(
      'C:\\Windows\\System32\\OpenSSH',
      'C:\\Windows\\System32',
      'C:\\Program Files\\Git\\usr\\bin',
      'C:\\Program Files\\Git\\bin',
    )
  }

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`)
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {
        /* ignore */
      }
    }
  }

  return command
}

function defaultShell(): string {
  // Resolve to an absolute path. node-pty needs the full path on Windows
  // when it has no PATH to fall back on (utilityProcess doesn't inherit
  // the user's PATH). Without this, `cmd.exe` resolves to "File not found"
  // because cmd.exe isn't in CWD.
  const env = inheritedEnv
  if (process.platform === 'win32') {
    const candidates = [
      env.ComSpec,
      env.COMSPEC,
      `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`,
      'C:\\Windows\\System32\\cmd.exe',
      'cmd.exe',
    ]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate) continue
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {
        /* ignore stat errors */
      }
    }
    return 'cmd.exe'
  }
  return env.SHELL ?? '/bin/bash'
}

function createSession(payload: TerminalCreateParams | undefined): { id: string } {
  const id = randomUUID()
  const cwd = validateTerminalCwd(payload?.cwd, process.env.HOME ?? process.env.USERPROFILE ?? '/')
  const purpose = payload?.purpose === 'vendor' ? 'vendor' : 'terminal'
  // PowerShell integration is opt-in. The Windows PowerShell 5 host
  // (System32\WindowsPowerShell\v1.0\powershell.exe) is broken on machines
  // with crypto/CAPI errors (NTE_BAD_KEYSET — error 8009001d) and exits
  // immediately after `-File bootstrap.ps1`. Until we add a robust
  // cmd.exe/PSReadLine fallback, default to the OS default shell (cmd.exe on
  // Windows, /bin/bash elsewhere) and let the frontend's idle-finalizer
  // (2.5s of no PTY output) close out running blocks. PowerShell-specific
  // command_start/command_end markers stay disabled so the bootstrap crash
  // can't take the whole session down.
  void purpose
  const integration: ReturnType<typeof createPowerShellIntegration> = null
  const requested = payload?.command?.trim() || defaultShell()
  let args = normalizeTerminalArgs(payload?.args)

  const env = {
    ...cleanEnv(inheritedEnv),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }
  // eslint-disable-next-line no-console
  console.log('[terminalWorker spawn]', requested, 'PATH preview:', env.PATH?.slice(0, 150), 'has docker:', env.PATH?.toLowerCase().includes('docker'))

  const spawnBinary = resolveExecutablePath(requested, env.PATH)
  const terminal = pty.spawn(spawnBinary, args, {
    name: 'xterm-256color',
    cwd,
    cols: clampTerminalCols(payload?.cols),
    rows: clampTerminalRows(payload?.rows),
    // ConPTY on Windows lets native subprocesses (Docker, ssh, etc.) bypass
    // the PTY pipe and write directly to the host console. That silently
    // drops their output from our renderer. WinPTY funnels every byte
    // through the pipe so docker compose ps / git / etc. show up.
    useConpty: false,
    env,
  })

  const session: Session = {
    id,
    pty: terminal,
    cwd,
    command: requested,
    args,
    projectId: payload?.projectId?.trim() || undefined,
    purpose,
    sequence: 0,
    markerParser: integration ? new ShellMarkerParser(integration.nonce) : undefined,
  }
  sessions.set(id, session)

  terminal.onData((data) => {
    if (session.markerParser) {
      let visible = ''
      for (const token of session.markerParser.push(data)) {
        if (token.type === 'data') {
          sendData(session, token.data)
          visible += token.data
        } else {
          sendShellMarker(session, token.marker)
        }
      }
      if (visible) onCommandActivity(session, visible)
      return
    }
    sendData(session, data)
  })

  terminal.onExit(({ exitCode, signal }) => {
    if (sessions.get(id) !== session) return
    if (session.commandActive) {
      clearTimeout(session.commandActive.hardTimer)
      if (session.commandActive.idleTimer) clearTimeout(session.commandActive.idleTimer)
      session.commandActive = undefined
    }
    sessions.delete(id)
    send({
      type: 'exit',
      id,
      sequence: nextSequence(session),
      projectId: session.projectId,
      purpose: session.purpose,
      exitCode,
      signal,
    })
  })

  return { id, command: requested, args, cwd, shellLabel: integration?.shellLabel ?? path.basename(requested) }
}

function writeSession(id: unknown, data: unknown): void {
  const sessionId = normalizeTerminalId(id)
  const dataStr = normalizeTerminalWrite(data)
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`terminal session not found: ${sessionId}`)
  session.pty.write(dataStr)
}

function resizeSession(id: unknown, cols: unknown, rows: unknown): void {
  const sessionId = normalizeTerminalId(id)
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`terminal session not found: ${sessionId}`)
  session.pty.resize(clampTerminalCols(cols), clampTerminalRows(rows))
}

function killSession(id: unknown): void {
  const sessionId = normalizeTerminalId(id)
  const session = sessions.get(sessionId)
  if (!session) return
  if (session.commandActive) {
    clearTimeout(session.commandActive.hardTimer)
    if (session.commandActive.idleTimer) clearTimeout(session.commandActive.idleTimer)
    session.commandActive = undefined
  }
  sessions.delete(sessionId)
  try { session.pty.kill() } catch { /* already exited */ }
}

interface CreateReply {
  type: 'createReply'
  correlationId: number
  ok: true
  id: string
  command: string
  args: string[]
  cwd: string
  shellLabel: string
}
interface ErrorReply {
  type: 'createReply'
  correlationId: number
  ok: false
  error: string
}

process.parentPort?.on('message', (event: { data: unknown }) => {
  const message = event.data as {
    type: string
    correlationId?: number
    id?: unknown
    data?: unknown
    cols?: unknown
    rows?: unknown
    payload?: TerminalCreateParams
  }
  nextWorkerId += 1
  const correlationId = message.correlationId ?? nextWorkerId
  try {
    if (message.type === 'init') {
      const env = (message as { env?: NodeJS.ProcessEnv }).env
      if (env && typeof env === 'object') {
        inheritedEnv = { ...inheritedEnv, ...env }
      }
      // eslint-disable-next-line no-console
      console.log('[terminalWorker] init received, env keys:', Object.keys(inheritedEnv).length, 'PATH chars:', inheritedEnv.PATH?.length)
      process.parentPort?.postMessage({ type: 'initReply', correlationId })
      return
    }
    if (message.type === 'create') {
      const created = createSession(message.payload)
      const reply: CreateReply = {
        type: 'createReply',
        correlationId,
        ok: true,
        id: created.id,
        command: created.command,
        args: created.args,
        cwd: created.cwd,
        shellLabel: created.shellLabel,
      }
      process.parentPort?.postMessage(reply)
      return
    }
    if (message.type === 'write') {
      writeSession(message.id, message.data)
      return
    }
    if (message.type === 'resize') {
      resizeSession(message.id, message.cols, message.rows)
      return
    }
    if (message.type === 'kill') {
      killSession(message.id)
      return
    }
  } catch (err) {
    if (message.type === 'create') {
      const reply: ErrorReply = {
        type: 'createReply',
        correlationId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
      process.parentPort?.postMessage(reply)
    }
  }
})

// eslint-disable-next-line no-console
console.log('[terminalWorker] ready', { PATH: process.env.PATH, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT })
