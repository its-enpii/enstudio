import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  ensureMcpConfigScaffold,
  loadMcpConfig,
  mcpCallTool,
  mcpDisconnectAll,
  mcpListTools,
} from './mcp.js'

/** Tiny MCP-ish stdio server for tests (Content-Length framing). */
const FAKE_SERVER = `
const tools = [{ name: 'echo', description: 'echo args', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }];
let buf = Buffer.alloc(0);
function send(obj) {
  const body = JSON.stringify(obj);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
}
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const i = buf.indexOf('\\r\\n\\r\\n');
    if (i < 0) return;
    const header = buf.subarray(0, i).toString();
    const m = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!m) { buf = buf.subarray(i + 4); continue; }
    const len = Number(m[1]);
    if (buf.length < i + 4 + len) return;
    const body = buf.subarray(i + 4, i + 4 + len).toString();
    buf = buf.subarray(i + 4 + len);
    let msg; try { msg = JSON.parse(body); } catch { continue; }
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } } });
    } else if (msg.method === 'notifications/initialized') {
      // no-op
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
    } else if (msg.method === 'tools/call') {
      const text = String((msg.params && msg.params.arguments && msg.params.arguments.text) || 'hi');
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + text }] } });
    } else if (msg.id != null) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown' } });
    }
  }
});
`

describe('mcp', () => {
  const home = path.join(os.tmpdir(), `enpii-mcp-${Date.now()}`)
  const prevHome = process.env.ENPII_HOME
  const serverJs = path.join(home, 'fake-mcp-server.mjs')

  before(() => {
    fs.mkdirSync(home, { recursive: true })
    process.env.ENPII_HOME = home
    fs.writeFileSync(serverJs, FAKE_SERVER, 'utf8')
    fs.writeFileSync(
      path.join(home, 'mcp.json'),
      JSON.stringify({
        servers: {
          fake: { command: process.execPath, args: [serverJs] },
        },
      }),
      'utf8',
    )
  })

  after(() => {
    mcpDisconnectAll()
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('loadMcpConfig reads servers', () => {
    const cfg = loadMcpConfig()
    assert.ok(cfg.fake)
    assert.ok('command' in cfg.fake!)
    assert.equal(cfg.fake!.command, process.execPath)
  })

  it('loadMcpConfig accepts http url entries', () => {
    fs.writeFileSync(
      path.join(home, 'mcp.json'),
      JSON.stringify({
        servers: {
          fake: { command: process.execPath, args: [serverJs] },
          remote: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } },
        },
      }),
      'utf8',
    )
    const cfg = loadMcpConfig()
    assert.ok(cfg.remote && 'url' in cfg.remote)
    assert.equal(cfg.remote.url, 'https://example.test/mcp')
    // restore stdio-only for later tests
    fs.writeFileSync(
      path.join(home, 'mcp.json'),
      JSON.stringify({ servers: { fake: { command: process.execPath, args: [serverJs] } } }),
      'utf8',
    )
  })

  it('ensureMcpConfigScaffold is idempotent when file exists', () => {
    const p = ensureMcpConfigScaffold()
    assert.equal(p, path.join(home, 'mcp.json'))
    assert.ok(loadMcpConfig().fake)
  })

  it('lists and calls tools on stdio server', async () => {
    const tools = await mcpListTools()
    assert.ok(tools.some((t) => t.server === 'fake' && t.name === 'echo'))
    const out = await mcpCallTool(undefined, 'fake', 'echo', { text: 'ping' })
    assert.match(out, /echo:ping/)
  })
})

// keep spawn import available for future extensions
void spawn
