import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runTool } from './run.js'
import { resolveInRoot } from './paths.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

describe('tools R/O', () => {
  it('jails path escape', () => {
    assert.throws(() => resolveInRoot(root, '../outside'), /outside workspace/)
  })

  it('list_dir root', async () => {
    const r = await runTool(root, 'list_dir', JSON.stringify({ path: '.' }))
    assert.equal(r.ok, true)
    assert.match(r.content, /package\.json|apps|packages/)
  })

  it('read_file package.json', async () => {
    const r = await runTool(root, 'read_file', JSON.stringify({ path: 'package.json' }))
    assert.equal(r.ok, true)
    assert.match(r.content, /enpiistudio/)
  })

  it('glob ts files', async () => {
    const r = await runTool(root, 'glob', JSON.stringify({ pattern: 'packages/agent-core/src/**/*.ts', maxResults: 20 }))
    assert.equal(r.ok, true)
    assert.match(r.content, /loop\.ts|cli\.ts/)
  })

  it('grep name', async () => {
    const r = await runTool(
      root,
      'grep',
      JSON.stringify({ pattern: 'enpiistudio', path: 'package.json', maxResults: 5 }),
    )
    assert.equal(r.ok, true)
    assert.match(r.content, /package\.json/)
  })
})

describe('tools write', () => {
  it('write + edit under temp root', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const { previewWriteTool, unifiedLineDiff } = await import('./run.js')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-tool-'))
    try {
      const w = await runTool(
        tmp,
        'write_file',
        JSON.stringify({ path: 'a/hello.txt', content: 'hello world' }),
      )
      assert.equal(w.ok, true)
      assert.equal(fs.readFileSync(path.join(tmp, 'a/hello.txt'), 'utf8'), 'hello world')

      const e = await runTool(
        tmp,
        'edit_file',
        JSON.stringify({
          path: 'a/hello.txt',
          old_string: 'world',
          new_string: 'enpii',
        }),
      )
      assert.equal(e.ok, true)
      assert.equal(fs.readFileSync(path.join(tmp, 'a/hello.txt'), 'utf8'), 'hello enpii')

      const bad = await runTool(
        tmp,
        'edit_file',
        JSON.stringify({
          path: 'a/hello.txt',
          old_string: 'missing',
          new_string: 'x',
        }),
      )
      assert.equal(bad.ok, false)

      const ud = unifiedLineDiff('hello world', 'hello enpii', 'a/hello.txt')
      assert.match(ud, /--- a\/a\/hello\.txt/)
      assert.match(ud, /^-hello world/m)
      assert.match(ud, /^\+hello enpii/m)

      const prev = previewWriteTool(
        tmp,
        'edit_file',
        JSON.stringify({
          path: 'a/hello.txt',
          old_string: 'hello enpii',
          new_string: 'hello again',
        }),
      )
      assert.match(prev.preview, /^\+hello again/m)

      // CRLF file + LF old_string from model
      fs.writeFileSync(path.join(tmp, 'crlf.txt'), 'line1\r\nline2\r\nline3\r\n', 'utf8')
      const crlfEdit = await runTool(
        tmp,
        'edit_file',
        JSON.stringify({
          path: 'crlf.txt',
          old_string: 'line2\n',
          new_string: 'LINE2\n',
        }),
      )
      assert.equal(crlfEdit.ok, true)
      assert.equal(
        fs.readFileSync(path.join(tmp, 'crlf.txt'), 'utf8'),
        'line1\r\nLINE2\r\nline3\r\n',
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
