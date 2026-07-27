/**
 * Minimal MCP client (stdio JSON-RPC, Content-Length framing) + HTTP via mcp-http.
 * Config: ~/.enpiistudio/mcp.json and/or project .enpii/mcp.json
 *
 * {
 *   "servers": {
 *     "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
 *     "remote": { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } }
 *   }
 * }
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  isHttpMcpConfig,
  mcpHttpCallTool,
  mcpHttpDisconnectAll,
  mcpHttpGetPrompt,
  mcpHttpListPrompts,
  mcpHttpListResources,
  mcpHttpListTools,
  mcpHttpReadResource,
  type McpHttpServerConfig,
} from './mcp-http.js'

export interface McpStdioServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

/** @deprecated alias — prefer McpStdioServerConfig */
export type McpServerConfig = McpStdioServerConfig

export type McpServerEntry = McpStdioServerConfig | McpHttpServerConfig

export interface McpConfigFile {
  servers?: Record<string, McpServerEntry>
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  server: string
}

export interface McpResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
  server: string
}

export interface McpPrompt {
  name: string
  description?: string
  arguments?: { name: string; description?: string; required?: boolean }[]
  server: string
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

function enpiiHome(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function isStdioMcpConfig(v: unknown): v is McpStdioServerConfig {
  return Boolean(v && typeof v === 'object' && typeof (v as McpStdioServerConfig).command === 'string' && (v as McpStdioServerConfig).command.trim())
}

export function loadMcpConfig(projectRoot?: string): Record<string, McpServerEntry> {
  const out: Record<string, McpServerEntry> = {}
  const files = [path.join(enpiiHome(), 'mcp.json')]
  if (projectRoot) files.push(path.join(path.resolve(projectRoot), '.enpii', 'mcp.json'))
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue
      const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as McpConfigFile
      for (const [name, cfg] of Object.entries(data.servers ?? {})) {
        if (isHttpMcpConfig(cfg)) {
          out[name] = {
            url: cfg.url.trim(),
            headers: cfg.headers && typeof cfg.headers === 'object' ? { ...cfg.headers } : undefined,
          }
          continue
        }
        if (!isStdioMcpConfig(cfg)) continue
        out[name] = {
          command: cfg.command.trim(),
          args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
          env: cfg.env && typeof cfg.env === 'object' ? cfg.env : undefined,
          cwd: typeof cfg.cwd === 'string' ? cfg.cwd : undefined,
        }
      }
    } catch {
      /* skip */
    }
  }
  return out
}

export function mcpTransportOf(cfg: McpServerEntry): 'stdio' | 'http' {
  return isHttpMcpConfig(cfg) ? 'http' : 'stdio'
}

class McpSession {
  private child: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = Buffer.alloc(0)
  private ready: Promise<void>
  private closed = false
  readonly name: string

  constructor(name: string, cfg: McpStdioServerConfig) {
    this.name = name
    this.child = spawn(cfg.command, cfg.args ?? [], {
      cwd: cfg.cwd,
      env: { ...process.env, ...cfg.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8').trim()
      if (msg) console.error(`[mcp:${name}] ${msg.slice(0, 400)}`)
    })
    this.child.on('error', (err) => this.failAll(err))
    this.child.on('exit', () => {
      this.closed = true
      this.failAll(new Error(`mcp server exited: ${name}`))
    })
    this.ready = this.initialize()
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) {
        // try newline-delimited JSON fallback (some servers)
        const nl = this.buffer.indexOf('\n')
        if (nl < 0) return
        const line = this.buffer.subarray(0, nl).toString('utf8').trim()
        this.buffer = this.buffer.subarray(nl + 1)
        if (!line || line.startsWith('Content-Length')) continue
        try {
          this.handleMessage(JSON.parse(line) as Record<string, unknown>)
        } catch {
          /* ignore */
        }
        continue
      }
      const header = this.buffer.subarray(0, headerEnd).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const len = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + len) return
      const body = this.buffer.subarray(bodyStart, bodyStart + len).toString('utf8')
      this.buffer = this.buffer.subarray(bodyStart + len)
      try {
        this.handleMessage(JSON.parse(body) as Record<string, unknown>)
      } catch {
        /* ignore */
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) {
        const err = msg.error as { message?: string }
        p.reject(new Error(err.message || 'mcp error'))
      } else {
        p.resolve(msg.result)
      }
      return
    }
    // notifications ignored for now
  }

  private send(payload: Record<string, unknown>): void {
    if (this.closed) throw new Error(`mcp server closed: ${this.name}`)
    const body = JSON.stringify(payload)
    const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
    this.child.stdin.write(frame)
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (err) {
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`mcp timeout: ${method}`))
        }
      }, 30_000)
    })
  }

  private async initialize(): Promise<void> {
    const result = (await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'enpii', version: '0.1.0' },
    })) as { protocolVersion?: string }
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    void result
  }

  async listTools(): Promise<McpTool[]> {
    await this.ready
    const result = (await this.request('tools/list', {})) as {
      tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[]
    }
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      server: this.name,
    }))
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.ready
    const result = (await this.request('tools/call', {
      name,
      arguments: args,
    })) as {
      content?: { type?: string; text?: string }[]
      isError?: boolean
    }
    const texts = (result.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
    const body = texts.join('\n') || JSON.stringify(result)
    if (result.isError) throw new Error(body)
    return body
  }

  async listResources(): Promise<McpResource[]> {
    await this.ready
    try {
      const result = (await this.request('resources/list', {})) as {
        resources?: { uri: string; name?: string; description?: string; mimeType?: string }[]
      }
      return (result.resources ?? []).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        server: this.name,
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/method not found|unknown|-32601/i.test(msg)) return []
      throw err
    }
  }

  async readResource(uri: string): Promise<string> {
    await this.ready
    const result = (await this.request('resources/read', { uri })) as {
      contents?: { uri?: string; mimeType?: string; text?: string; blob?: string }[]
    }
    return formatResourceContents(result.contents)
  }

  async listPrompts(): Promise<McpPrompt[]> {
    await this.ready
    try {
      const result = (await this.request('prompts/list', {})) as {
        prompts?: {
          name: string
          description?: string
          arguments?: { name: string; description?: string; required?: boolean }[]
        }[]
      }
      return (result.prompts ?? []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
        server: this.name,
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/method not found|unknown|-32601/i.test(msg)) return []
      throw err
    }
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<string> {
    await this.ready
    const result = await this.request('prompts/get', {
      name,
      ...(args && Object.keys(args).length ? { arguments: args } : {}),
    })
    return formatPromptResult(result)
  }

  close(): void {
    this.closed = true
    try {
      this.child.stdin.end()
    } catch {
      /* ignore */
    }
    try {
      this.child.kill()
    } catch {
      /* ignore */
    }
    this.failAll(new Error('mcp closed'))
  }
}

const sessions = new Map<string, McpSession>()

export function mcpDisconnectAll(): void {
  for (const s of sessions.values()) s.close()
  sessions.clear()
  mcpHttpDisconnectAll()
}

function getSession(name: string, cfg: McpStdioServerConfig): McpSession {
  const existing = sessions.get(name)
  if (existing) return existing
  const s = new McpSession(name, cfg)
  sessions.set(name, s)
  return s
}

export async function mcpListServers(projectRoot?: string): Promise<string[]> {
  return Object.keys(loadMcpConfig(projectRoot))
}

export async function mcpListTools(projectRoot?: string, serverName?: string): Promise<McpTool[]> {
  const cfgs = loadMcpConfig(projectRoot)
  const names = serverName ? [serverName] : Object.keys(cfgs)
  const out: McpTool[] = []
  for (const name of names) {
    const cfg = cfgs[name]
    if (!cfg) continue
    try {
      if (isHttpMcpConfig(cfg)) {
        out.push(...(await mcpHttpListTools(name, cfg)))
      } else {
        out.push(...(await getSession(name, cfg).listTools()))
      }
    } catch (err) {
      console.error(`[mcp] list tools failed for ${name}`, err)
    }
  }
  return out
}

export async function mcpCallTool(
  projectRoot: string | undefined,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  const cfgs = loadMcpConfig(projectRoot)
  const cfg = cfgs[server]
  if (!cfg) throw new Error(`unknown mcp server: ${server}`)
  if (isHttpMcpConfig(cfg)) return mcpHttpCallTool(server, cfg, tool, args)
  return getSession(server, cfg).callTool(tool, args)
}

export async function mcpListResources(projectRoot?: string, serverName?: string): Promise<McpResource[]> {
  const cfgs = loadMcpConfig(projectRoot)
  const names = serverName ? [serverName] : Object.keys(cfgs)
  const out: McpResource[] = []
  for (const name of names) {
    const cfg = cfgs[name]
    if (!cfg) continue
    try {
      if (isHttpMcpConfig(cfg)) out.push(...(await mcpHttpListResources(name, cfg)))
      else out.push(...(await getSession(name, cfg).listResources()))
    } catch (err) {
      console.error(`[mcp] list resources failed for ${name}`, err)
    }
  }
  return out
}

export async function mcpReadResource(
  projectRoot: string | undefined,
  server: string,
  uri: string,
): Promise<string> {
  const cfgs = loadMcpConfig(projectRoot)
  const cfg = cfgs[server]
  if (!cfg) throw new Error(`unknown mcp server: ${server}`)
  if (!uri.trim()) throw new Error('resource uri required')
  if (isHttpMcpConfig(cfg)) return mcpHttpReadResource(server, cfg, uri.trim())
  return getSession(server, cfg).readResource(uri.trim())
}

export async function mcpListPrompts(projectRoot?: string, serverName?: string): Promise<McpPrompt[]> {
  const cfgs = loadMcpConfig(projectRoot)
  const names = serverName ? [serverName] : Object.keys(cfgs)
  const out: McpPrompt[] = []
  for (const name of names) {
    const cfg = cfgs[name]
    if (!cfg) continue
    try {
      if (isHttpMcpConfig(cfg)) out.push(...(await mcpHttpListPrompts(name, cfg)))
      else out.push(...(await getSession(name, cfg).listPrompts()))
    } catch (err) {
      console.error(`[mcp] list prompts failed for ${name}`, err)
    }
  }
  return out
}

export async function mcpGetPrompt(
  projectRoot: string | undefined,
  server: string,
  name: string,
  args?: Record<string, string>,
): Promise<string> {
  const cfgs = loadMcpConfig(projectRoot)
  const cfg = cfgs[server]
  if (!cfg) throw new Error(`unknown mcp server: ${server}`)
  if (!name.trim()) throw new Error('prompt name required')
  if (isHttpMcpConfig(cfg)) return mcpHttpGetPrompt(server, cfg, name.trim(), args)
  return getSession(server, cfg).getPrompt(name.trim(), args)
}

function formatResourceContents(
  contents?: { uri?: string; mimeType?: string; text?: string; blob?: string }[],
): string {
  if (!contents?.length) return '(empty resource)'
  const parts: string[] = []
  for (const c of contents) {
    const head = [c.uri, c.mimeType].filter(Boolean).join(' · ')
    if (typeof c.text === 'string') {
      parts.push(head ? `${head}\n${c.text}` : c.text)
      continue
    }
    if (typeof c.blob === 'string') {
      parts.push(`${head || 'blob'}\n[binary base64 ${c.blob.length} chars]`)
      continue
    }
    parts.push(JSON.stringify(c))
  }
  return parts.join('\n\n').slice(0, 100_000)
}

function formatPromptResult(result: unknown): string {
  const r = result as {
    description?: string
    messages?: { role?: string; content?: unknown }[]
  } | null
  if (!r || typeof r !== 'object') return JSON.stringify(result)
  const lines: string[] = []
  if (r.description) lines.push(r.description)
  for (const m of r.messages ?? []) {
    const role = m.role ?? 'message'
    let body = ''
    if (typeof m.content === 'string') body = m.content
    else if (Array.isArray(m.content)) {
      body = m.content
        .map((part) => {
          if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: string }).text ?? '')
          return JSON.stringify(part)
        })
        .filter(Boolean)
        .join('\n')
    } else if (m.content && typeof m.content === 'object' && 'text' in (m.content as object)) {
      body = String((m.content as { text?: string }).text ?? '')
    } else body = JSON.stringify(m.content ?? '')
    lines.push(`[${role}]\n${body}`)
  }
  return (lines.join('\n\n') || JSON.stringify(result)).slice(0, 100_000)
}

/** Ensure sample mcp.json exists under ENPII home (comments only). */
export function ensureMcpConfigScaffold(): string {
  const file = path.join(enpiiHome(), 'mcp.json')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        {
          servers: {},
          _example: {
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'],
            },
            remote: {
              url: 'https://mcp.example.com/mcp',
              headers: { Authorization: 'Bearer …' },
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
