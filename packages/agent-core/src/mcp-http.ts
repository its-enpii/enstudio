/**
 * Minimal MCP Streamable HTTP client (JSON-RPC over POST).
 * Stdio transport: `mcp.ts`. OAuth / rich SSE progress: ponytail later.
 */

export type McpHttpServerConfig = {
  /** e.g. https://mcp.example.com/mcp */
  url: string
  headers?: Record<string, string>
}

export type McpHttpTool = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  server: string
}

const PROTOCOL = '2024-11-05'
const TIMEOUT_MS = 30_000

export function isHttpMcpConfig(v: unknown): v is McpHttpServerConfig {
  return Boolean(v && typeof v === 'object' && typeof (v as McpHttpServerConfig).url === 'string' && (v as McpHttpServerConfig).url.trim())
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

type JsonRpc = {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { message?: string; code?: number }
  method?: string
}

function toolText(result: unknown): string {
  const r = result as { content?: { type?: string; text?: string }[]; isError?: boolean } | null
  if (!r || typeof r !== 'object') return JSON.stringify(result)
  const texts = (r.content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
  const body = texts.join('\n') || JSON.stringify(result)
  if (r.isError) throw new Error(body)
  return body
}

/** Parse one JSON-RPC response from plain JSON or simple SSE `data:` lines. */
function parseRpcResponse(raw: string): JsonRpc {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('empty MCP HTTP response')
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as JsonRpc
  }
  // SSE: take last JSON data payload with id/result/error
  let last: JsonRpc | undefined
  for (const line of trimmed.split(/\r?\n/)) {
    const m = /^data:\s*(.+)$/.exec(line)
    if (!m) continue
    const data = m[1].trim()
    if (!data || data === '[DONE]') continue
    try {
      const obj = JSON.parse(data) as JsonRpc
      if (obj && (obj.result !== undefined || obj.error !== undefined || obj.id !== undefined)) last = obj
    } catch {
      /* skip non-json sse */
    }
  }
  if (last) return last
  throw new Error(`MCP HTTP response not JSON-RPC: ${trimmed.slice(0, 200)}`)
}

class HttpMcpSession {
  private nextId = 1
  private sessionId: string | undefined
  private ready: Promise<void>
  private closed = false
  readonly name: string
  readonly cfg: McpHttpServerConfig

  constructor(name: string, cfg: McpHttpServerConfig) {
    this.name = name
    this.cfg = {
      url: cfg.url.trim(),
      headers: cfg.headers && typeof cfg.headers === 'object' ? { ...cfg.headers } : undefined,
    }
    this.ready = this.initialize()
  }

  private async post(payload: Record<string, unknown>, notification = false): Promise<JsonRpc | undefined> {
    if (this.closed) throw new Error(`mcp http closed: ${this.name}`)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.cfg.headers ?? {}),
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(this.cfg.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ac.signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`mcp http timeout: ${String(payload.method ?? 'request')}`)
      }
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      clearTimeout(timer)
    }

    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid

    if (notification) {
      if (!res.ok && res.status !== 202 && res.status !== 204) {
        const t = await res.text().catch(() => '')
        throw new Error(`mcp http notify failed ${res.status}: ${t.slice(0, 200)}`)
      }
      return undefined
    }

    const raw = await res.text()
    if (!res.ok) {
      throw new Error(`mcp http ${res.status}: ${raw.slice(0, 300) || res.statusText}`)
    }
    return parseRpcResponse(raw)
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const msg = await this.post({ jsonrpc: '2.0', id, method, params })
    if (!msg) throw new Error(`mcp http empty result: ${method}`)
    if (msg.error) throw new Error(msg.error.message || `mcp error ${msg.error.code ?? ''}`)
    return msg.result
  }

  private async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'enpii', version: '0.1.0' },
    })
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, true)
  }

  async listTools(): Promise<McpHttpTool[]> {
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
    const result = await this.request('tools/call', { name, arguments: args })
    return toolText(result)
  }

  close(): void {
    this.closed = true
  }
}

const httpSessions = new Map<string, HttpMcpSession>()

function sessionKey(name: string, cfg: McpHttpServerConfig): string {
  return `${name}::${cfg.url.trim()}`
}

function getHttpSession(name: string, cfg: McpHttpServerConfig): HttpMcpSession {
  const key = sessionKey(name, cfg)
  const existing = httpSessions.get(key)
  if (existing) return existing
  const s = new HttpMcpSession(name, cfg)
  httpSessions.set(key, s)
  return s
}

export function mcpHttpDisconnectAll(): void {
  for (const s of httpSessions.values()) s.close()
  httpSessions.clear()
}

export async function mcpHttpListTools(name: string, cfg: McpHttpServerConfig): Promise<McpHttpTool[]> {
  return getHttpSession(name, cfg).listTools()
}

export async function mcpHttpCallTool(
  name: string,
  cfg: McpHttpServerConfig,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  return getHttpSession(name, cfg).callTool(tool, args)
}

