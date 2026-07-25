import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

type JsonRpcId = string | number

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export class EnpiiClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<JsonRpcId, Pending>()
  private nextId = 1
  private started = false

  start(): void {
    if (this.started) return
    this.started = true

    const { command, args, cwd, env } = resolveSpawn()
    this.emit('log', `[enpii] spawn ${command} ${args.join(' ')}`)

    this.child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', ...env },
      windowsHide: true,
      shell: false,
    })

    const rl = createInterface({ input: this.child.stdout })
    rl.on('line', (line) => this.onLine(line))

    this.child.stderr.on('data', (buf: Buffer) => {
      this.emit('log', buf.toString('utf8'))
    })

    this.child.on('error', (err) => {
      this.emit('log', `[enpii] spawn error: ${err.message}`)
      this.emit('exit', { code: -1, signal: null, error: err.message })
      this.started = false
      this.child = null
    })

    this.child.on('exit', (code, signal) => {
      this.emit('exit', { code, signal })
      for (const [, p] of this.pending) {
        p.reject(new Error(`enpii exited code=${code} signal=${signal}`))
      }
      this.pending.clear()
      this.child = null
      this.started = false
    })
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child) this.start()
    if (!this.child?.stdin) throw new Error('enpii not running')

    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  stop(): void {
    if (!this.child) return
    try {
      this.child.kill()
    } catch {
      /* ignore */
    }
    this.child = null
    this.started = false
  }

  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      this.emit('log', `bad json from enpii: ${trimmed}`)
      return
    }

    if (typeof msg.method === 'string' && msg.id === undefined) {
      this.emit('notification', { method: msg.method, params: msg.params })
      return
    }

    if ('id' in msg && this.pending.has(msg.id as JsonRpcId)) {
      const pending = this.pending.get(msg.id as JsonRpcId)!
      this.pending.delete(msg.id as JsonRpcId)
      if (msg.error) {
        const err = msg.error as { message?: string }
        pending.reject(new Error(err.message ?? 'RPC error'))
      } else {
        pending.resolve(msg.result)
      }
    }
  }
}

function monorepoRootFromElectron(): string {
  // electron compiled to apps/desktop/dist-electron → ../../../ = repo root
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '../../..')
}

/** process.execPath inside Electron is electron.exe — not a Node runtime unless ELECTRON_RUN_AS_NODE=1. */
function resolveNodeRuntime(): { command: string; env: Record<string, string> } {
  const exec = process.execPath
  const isElectron =
    process.versions.electron != null ||
    /[\\/]electron([\\/]|$)/i.test(exec) ||
    path.basename(exec).toLowerCase().includes('electron')

  if (!isElectron) {
    return { command: exec, env: {} }
  }

  // Prefer real node next to common install layouts / PATH
  const candidates = [
    process.env.npm_node_execpath,
    process.env.NODE_BINARY,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)

  for (const c of candidates) {
    if (fs.existsSync(c)) return { command: c, env: {} }
  }

  // Fall back: Electron binary as Node
  return {
    command: exec,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

function resolveSpawn(): {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
} {
  const root = monorepoRootFromElectron()
  const jsEntry = path.join(root, 'packages/agent-core/dist/cli.js')
  const tsEntry = path.join(root, 'packages/agent-core/src/cli.ts')
  const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs')
  const { command, env } = resolveNodeRuntime()

  if (fs.existsSync(jsEntry)) {
    return { command, args: [jsEntry], cwd: root, env }
  }

  if (fs.existsSync(tsEntry) && fs.existsSync(tsxCli)) {
    return { command, args: [tsxCli, tsEntry], cwd: root, env }
  }

  throw new Error(
    `enpii entry not found. Expected ${jsEntry} or ${tsEntry} (+ tsx). Run: npm run build -w @enpiistudio/agent-core`,
  )
}
