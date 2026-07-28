/**
 * SSH / tunnel config + managed local-forward processes (PRD #6).
 *
 * ~/.enpiistudio/ssh.json:
 * {
 *   "hosts": {
 *     "prod": { "host": "1.2.3.4", "user": "ubuntu", "port": 22, "identityFile": "~/.ssh/id_ed25519" }
 *   },
 *   "tunnels": {
 *     "db": { "host": "prod", "localPort": 5433, "remoteHost": "127.0.0.1", "remotePort": 5432 }
 *   }
 * }
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface SshHostConfig {
  host: string
  user?: string
  port?: number
  identityFile?: string
  /** Extra ssh -o options, e.g. ["StrictHostKeyChecking=accept-new"] */
  options?: string[]
}

export interface SshTunnelConfig {
  /** Key into hosts map, or inline host hostname */
  host: string
  localPort: number
  remoteHost?: string
  remotePort: number
}

export interface SshConfigFile {
  hosts?: Record<string, SshHostConfig>
  tunnels?: Record<string, SshTunnelConfig>
}

function enpiiHome(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function configPath(): string {
  return path.join(enpiiHome(), 'ssh.json')
}

export function ensureSshConfigScaffold(): string {
  const file = configPath()
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        {
          hosts: {},
          tunnels: {},
          _example: {
            hosts: {
              prod: {
                host: '203.0.113.10',
                user: 'ubuntu',
                port: 22,
                identityFile: '~/.ssh/id_ed25519',
              },
            },
            tunnels: {
              db: {
                host: 'prod',
                localPort: 5433,
                remoteHost: '127.0.0.1',
                remotePort: 5432,
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
  return file
}

export function loadSshConfig(): { hosts: Record<string, SshHostConfig>; tunnels: Record<string, SshTunnelConfig> } {
  ensureSshConfigScaffold()
  try {
    const raw = fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, '')
    const data = JSON.parse(raw) as SshConfigFile
    const hosts: Record<string, SshHostConfig> = {}
    for (const [name, h] of Object.entries(data.hosts ?? {})) {
      if (!h?.host?.trim()) continue
      hosts[name] = {
        host: h.host.trim(),
        user: typeof h.user === 'string' ? h.user : undefined,
        port: typeof h.port === 'number' && h.port > 0 ? Math.floor(h.port) : 22,
        identityFile: typeof h.identityFile === 'string' ? h.identityFile : undefined,
        options: Array.isArray(h.options) ? h.options.map(String) : undefined,
      }
    }
    const tunnels: Record<string, SshTunnelConfig> = {}
    for (const [name, t] of Object.entries(data.tunnels ?? {})) {
      if (!t?.host?.trim() || typeof t.localPort !== 'number' || typeof t.remotePort !== 'number') continue
      tunnels[name] = {
        host: t.host.trim(),
        localPort: Math.floor(t.localPort),
        remoteHost: typeof t.remoteHost === 'string' ? t.remoteHost : '127.0.0.1',
        remotePort: Math.floor(t.remotePort),
      }
    }
    return { hosts, tunnels }
  } catch {
    return { hosts: {}, tunnels: {} }
  }
}

/** Read raw file so we preserve tunnels/_example when rewriting hosts. */
function readRawSshFile(): SshConfigFile {
  ensureSshConfigScaffold()
  try {
    const raw = fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, '')
    return JSON.parse(raw) as SshConfigFile
  } catch {
    return { hosts: {}, tunnels: {} }
  }
}

function writeSshFile(data: SshConfigFile): void {
  const file = ensureSshConfigScaffold()
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export type SshHostInput = {
  name: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  /** Rename: previous key when editing name */
  previousName?: string
}

export function upsertSshHost(input: SshHostInput): { name: string } {
  const name = input.name.trim()
  if (!name || /[\\/]/.test(name)) throw new Error('invalid host name')
  const host = input.host?.trim()
  if (!host) throw new Error('host is required')
  const port = typeof input.port === 'number' && input.port > 0 ? Math.floor(input.port) : 22
  const entry: SshHostConfig = {
    host,
    port,
    ...(input.user?.trim() ? { user: input.user.trim() } : {}),
    ...(input.identityFile?.trim() ? { identityFile: input.identityFile.trim() } : {}),
  }
  const data = readRawSshFile()
  const hosts = { ...(data.hosts ?? {}) }
  const prev = input.previousName?.trim()
  if (prev && prev !== name && hosts[prev]) delete hosts[prev]
  hosts[name] = entry
  data.hosts = hosts
  writeSshFile(data)
  return { name }
}

export function deleteSshHost(name: string): { deleted: boolean } {
  const key = name.trim()
  if (!key) throw new Error('name is required')
  const data = readRawSshFile()
  const hosts = { ...(data.hosts ?? {}) }
  if (!(key in hosts)) return { deleted: false }
  delete hosts[key]
  data.hosts = hosts
  writeSshFile(data)
  return { deleted: true }
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** Build `ssh` argv for a named host (no spawn). */
export function sshArgv(hostName: string): { command: string; args: string[]; summary: string } {
  const { hosts } = loadSshConfig()
  const h = hosts[hostName]
  if (!h) throw new Error(`unknown ssh host: ${hostName}`)
  const args: string[] = []
  if (h.port && h.port !== 22) args.push('-p', String(h.port))
  if (h.identityFile) args.push('-i', expandHome(h.identityFile))
  for (const opt of h.options ?? []) args.push('-o', opt)
  const target = h.user ? `${h.user}@${h.host}` : h.host
  args.push(target)
  return {
    command: 'ssh',
    args,
    summary: `ssh ${args.join(' ')}`,
  }
}

/** Build local forward tunnel argv: ssh -N -L … (no spawn). */
export function tunnelArgv(tunnelName: string): { command: string; args: string[]; summary: string } {
  const { hosts, tunnels } = loadSshConfig()
  const t = tunnels[tunnelName]
  if (!t) throw new Error(`unknown tunnel: ${tunnelName}`)
  const h = hosts[t.host]
  const hostCfg = h ?? { host: t.host, port: 22 as number | undefined }
  const args: string[] = ['-N']
  if (hostCfg.port && hostCfg.port !== 22) args.push('-p', String(hostCfg.port))
  if (h?.identityFile) args.push('-i', expandHome(h.identityFile))
  for (const opt of h?.options ?? []) args.push('-o', opt)
  const remote = `${t.remoteHost ?? '127.0.0.1'}:${t.remotePort}`
  args.push('-L', `${t.localPort}:${remote}`)
  const target = h?.user ? `${h.user}@${hostCfg.host}` : hostCfg.host
  args.push(target)
  return {
    command: 'ssh',
    args,
    summary: `ssh ${args.join(' ')}`,
  }
}

export function sshConfigPath(): string {
  return configPath()
}

export function listSshHosts(): {
  name: string
  host: string
  user?: string
  port: number
  identityFile?: string
}[] {
  const { hosts } = loadSshConfig()
  return Object.entries(hosts).map(([name, h]) => ({
    name,
    host: h.host,
    user: h.user,
    port: h.port ?? 22,
    identityFile: h.identityFile,
  }))
}

export function listSshTunnels(): {
  name: string
  host: string
  localPort: number
  remoteHost: string
  remotePort: number
  running: boolean
  pid?: number
}[] {
  const { tunnels } = loadSshConfig()
  return Object.entries(tunnels).map(([name, t]) => {
    const live = liveTunnels.get(name)
    return {
      name,
      host: t.host,
      localPort: t.localPort,
      remoteHost: t.remoteHost ?? '127.0.0.1',
      remotePort: t.remotePort,
      running: Boolean(live && !live.child.killed),
      pid: live?.child.pid,
    }
  })
}

type LiveTunnel = {
  name: string
  child: ChildProcessWithoutNullStreams
  startedAt: string
  summary: string
  lastError?: string
}

const liveTunnels = new Map<string, LiveTunnel>()

export function listLiveTunnels(): {
  name: string
  pid?: number
  startedAt: string
  summary: string
  lastError?: string
}[] {
  return [...liveTunnels.entries()].map(([name, t]) => ({
    name,
    pid: t.child.pid,
    startedAt: t.startedAt,
    summary: t.summary,
    lastError: t.lastError,
  }))
}

/** Start managed `ssh -N -L` for a named tunnel. Idempotent if already running. */
export function startTunnel(tunnelName: string): {
  ok: true
  name: string
  pid?: number
  summary: string
  alreadyRunning?: boolean
} {
  const existing = liveTunnels.get(tunnelName)
  if (existing && !existing.child.killed) {
    return {
      ok: true,
      name: tunnelName,
      pid: existing.child.pid,
      summary: existing.summary,
      alreadyRunning: true,
    }
  }
  const plan = tunnelArgv(tunnelName)
  // BatchMode + ExitOnForwardFailure so bad config fails fast (no hang for password).
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    ...plan.args,
  ]
  const child = spawn(plan.command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: process.env,
  })
  const live: LiveTunnel = {
    name: tunnelName,
    child,
    startedAt: new Date().toISOString(),
    summary: `${plan.command} ${args.join(' ')}`,
  }
  child.stderr.on('data', (buf: Buffer) => {
    const msg = buf.toString('utf8').trim()
    if (msg) {
      live.lastError = msg.slice(0, 400)
      console.error(`[ssh:tunnel:${tunnelName}] ${live.lastError}`)
    }
  })
  child.on('error', (err) => {
    live.lastError = err.message
    liveTunnels.delete(tunnelName)
  })
  child.on('exit', (code, signal) => {
    if (liveTunnels.get(tunnelName)?.child === child) liveTunnels.delete(tunnelName)
    console.error(`[ssh:tunnel:${tunnelName}] exit code=${code} signal=${signal ?? ''}`)
  })
  liveTunnels.set(tunnelName, live)
  return { ok: true, name: tunnelName, pid: child.pid, summary: live.summary }
}

export function stopTunnel(tunnelName: string): { ok: true; stopped: boolean } {
  const live = liveTunnels.get(tunnelName)
  if (!live) return { ok: true, stopped: false }
  try {
    live.child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  // Force after short grace if still alive
  setTimeout(() => {
    try {
      if (!live.child.killed) live.child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 1500).unref?.()
  liveTunnels.delete(tunnelName)
  return { ok: true, stopped: true }
}

export function stopAllTunnels(): { stopped: string[] } {
  const names = [...liveTunnels.keys()]
  for (const name of names) stopTunnel(name)
  return { stopped: names }
}
