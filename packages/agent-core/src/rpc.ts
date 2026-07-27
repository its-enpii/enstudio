import readline from 'node:readline'
import type {
  JsonRpcError,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccess,
} from './types.js'

export type RpcHandler = (
  method: string,
  params: unknown,
  id: JsonRpcId | undefined,
) => Promise<unknown> | unknown

export class StdioJsonRpcServer {
  private handlers = new Map<string, RpcHandler>()
  private rl: readline.Interface | null = null

  on(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler)
  }

  start(): void {
    // Keep process alive for host-owned stdio; only exit when host closes stdin.
    if (typeof process.stdin.resume === 'function') {
      process.stdin.resume()
    }
    this.rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    // Fire-and-forget per line so concurrent session.prompt handlers can overlap.
    this.rl.on('line', (line) => {
      void this.onLine(line)
    })
    this.rl.on('close', () => {
      // Host closed the pipe — clean shutdown
      process.exit(0)
    })
  }

  notify(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params }
    this.write(msg)
  }

  private write(msg: JsonRpcMessage): void {
    process.stdout.write(`${JSON.stringify(msg)}\n`)
  }

  private async onLine(line: string): Promise<void> {
    const trimmed = line.trim()
    if (!trimmed) return

    let msg: JsonRpcRequest
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      this.write({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      } satisfies JsonRpcError)
      return
    }

    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      this.write({
        jsonrpc: '2.0',
        id: 'id' in msg ? msg.id : null,
        error: { code: -32600, message: 'Invalid Request' },
      } satisfies JsonRpcError)
      return
    }

    const isNotification = msg.id === undefined
    const handler = this.handlers.get(msg.method)
    if (!handler) {
      if (!isNotification) {
        this.write({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        } satisfies JsonRpcError)
      }
      return
    }

    try {
      const result = await handler(msg.method, msg.params, msg.id)
      if (!isNotification) {
        this.write({
          jsonrpc: '2.0',
          id: msg.id,
          result: result ?? null,
        } satisfies JsonRpcSuccess)
      }
    } catch (err) {
      if (!isNotification) {
        const message = err instanceof Error ? err.message : String(err)
        this.write({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message, data: { method: msg.method } },
        } satisfies JsonRpcError)
      }
    }
  }
}
