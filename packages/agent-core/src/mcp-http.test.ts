import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'
import {
  mcpHttpCallTool,
  mcpHttpDisconnectAll,
  mcpHttpListTools,
  type McpHttpServerConfig,
} from './mcp-http.js'

describe('mcp-http', () => {
  let server: http.Server
  let baseUrl = ''
  let cfg: McpHttpServerConfig

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        let msg: { id?: number; method?: string; params?: { name?: string; arguments?: { text?: string } } }
        try {
          msg = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          res.writeHead(400)
          res.end('bad json')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.setHeader('mcp-session-id', 'test-session')
        if (msg.method === 'notifications/initialized') {
          res.writeHead(202)
          res.end()
          return
        }
        if (msg.method === 'initialize') {
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake-http', version: '0' },
            },
          }))
          return
        }
        if (msg.method === 'tools/list') {
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }],
            },
          }))
          return
        }
        if (msg.method === 'tools/call') {
          const text = String(msg.params?.arguments?.text ?? 'hi')
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: `http-echo:${text}` }] },
          }))
          return
        }
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'unknown' },
        }))
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no addr')
    baseUrl = `http://127.0.0.1:${addr.port}/mcp`
    cfg = { url: baseUrl }
  })

  after(() => {
    mcpHttpDisconnectAll()
    server.close()
  })

  it('lists and calls tools over HTTP JSON-RPC', async () => {
    const tools = await mcpHttpListTools('remote', cfg)
    assert.ok(tools.some((t) => t.name === 'echo' && t.server === 'remote'))
    const out = await mcpHttpCallTool('remote', cfg, 'echo', { text: 'pong' })
    assert.match(out, /http-echo:pong/)
  })
})
