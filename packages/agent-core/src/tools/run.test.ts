import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runTool } from './run.js'
import { resolveInRoot } from './paths.js'
import { isMutatingTool } from './defs.js'

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

  it('search_codebase ranks path and body hits', async () => {
    const r = await runTool(
      root,
      'search_codebase',
      JSON.stringify({ query: 'enpiistudio agent-core', path: 'packages/agent-core', maxResults: 10 }),
    )
    assert.equal(r.ok, true)
    assert.match(r.content, /agent-core|package\.json|loop\.ts/i)
    assert.match(r.summary, /search_codebase/)
  })

  it('publishes a validated model task plan', async () => {
    const r = await runTool(root, 'plan_tasks', JSON.stringify({ tasks: [{ title: 'Inspect' }, { title: 'Implement', detail: 'Make the smallest safe change.' }] }))
    assert.equal(r.ok, true)
    assert.match(r.content, /task-1/)
    assert.match(r.content, /Implement/)
  })
})

describe('tools shell', () => {
  it('run_shell echo under temp root', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const { previewWriteTool } = await import('./run.js')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-shell-'))
    try {
      const r = await runTool(
        tmp,
        'run_shell',
        JSON.stringify({ command: 'echo hello-enpii' }),
      )
      assert.equal(r.ok, true)
      assert.match(r.content, /hello-enpii/)
      assert.match(r.summary, /exit 0/)

      const prev = previewWriteTool(
        tmp,
        'run_shell',
        JSON.stringify({ command: 'npm test', cwd: '.' }),
      )
      assert.match(prev.preview, /\$ npm test/)
      assert.match(prev.summary, /run_shell/)

      const blocked = await runTool(
        tmp,
        'run_shell',
        JSON.stringify({ command: 'git reset --hard' }),
      )
      assert.equal(blocked.ok, false)
      assert.match(blocked.content, /blocked/)

      const escape = await runTool(
        tmp,
        'run_shell',
        JSON.stringify({ command: 'echo x', cwd: '..' }),
      )
      assert.equal(escape.ok, false)
      assert.match(escape.content, /outside workspace/)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('tools git', () => {
  it('reads and mutates Git through structured tools', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-git-tool-'))
    const git = (...args: string[]) => {
      const result = spawnSync('git', ['-C', tmp, ...args], { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(result.stderr)
    }
    try {
      git('init')
      git('config', 'user.name', 'enpii test')
      git('config', 'user.email', 'test@enpii.local')
      fs.writeFileSync(path.join(tmp, 'note.txt'), 'one\n', 'utf8')
      git('add', 'note.txt')
      git('commit', '-m', 'initial')
      fs.writeFileSync(path.join(tmp, 'note.txt'), 'one\ntwo\n', 'utf8')

      const status = await runTool(tmp, 'git_status', '{}')
      assert.equal(status.ok, true)
      assert.match(status.content, /note\.txt/)

      const diff = await runTool(tmp, 'git_diff', JSON.stringify({ path: 'note.txt' }))
      assert.match(diff.content, /\+two/)

      assert.equal(isMutatingTool('git_status'), false)
      assert.equal(isMutatingTool('git_stage'), true)
      assert.equal((await runTool(tmp, 'git_stage', JSON.stringify({ path: 'note.txt' }))).ok, true)
      assert.equal((await runTool(tmp, 'git_commit', JSON.stringify({ message: 'update note' }))).ok, true)
      assert.equal((await runTool(tmp, 'git_branch', JSON.stringify({ action: 'create', name: 'feature/tool' }))).ok, true)

      const branches = await runTool(tmp, 'git_branches', '{}')
      assert.match(branches.content, /feature\/tool/)
      git('remote', 'add', 'origin', 'https://example.invalid/enpii.git')
      assert.match((await runTool(tmp, 'git_remotes', '{}')).content, /example\.invalid/)

      fs.writeFileSync(path.join(tmp, 'note.txt'), 'stashed by agent\n', 'utf8')
      assert.equal((await runTool(tmp, 'git_stash', JSON.stringify({ action: 'create', message: 'agent stash' }))).ok, true)
      const stashes = await runTool(tmp, 'git_stashes', '{}')
      assert.match(stashes.content, /agent stash/)
      assert.equal((await runTool(tmp, 'git_stash', JSON.stringify({ action: 'pop', ref: 'stash@{0}' }))).ok, true)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('sensitive deny globs', () => {
  it('blocks .env read/write', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const { isDeniedPath } = await import('./run.js')
    assert.equal(isDeniedPath('.env'), true)
    assert.equal(isDeniedPath('secrets/credentials.json'), true)
    assert.equal(isDeniedPath('src/app.ts'), false)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-deny-'))
    try {
      fs.writeFileSync(path.join(tmp, '.env'), 'SECRET=1\n', 'utf8')
      const r = await runTool(tmp, 'read_file', JSON.stringify({ path: '.env' }))
      assert.equal(r.ok, false)
      assert.match(r.summary, /denied/)
      const w = await runTool(tmp, 'write_file', JSON.stringify({ path: '.env.local', content: 'x=1' }))
      assert.equal(w.ok, false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
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

      // Existing file: write_file blocked without overwrite
      const blocked = await runTool(
        tmp,
        'write_file',
        JSON.stringify({ path: 'a/hello.txt', content: 'nuked' }),
      )
      assert.equal(blocked.ok, false)
      assert.match(blocked.summary, /already exists|overwrite/i)
      assert.equal(fs.readFileSync(path.join(tmp, 'a/hello.txt'), 'utf8'), 'hello world')

      const forced = await runTool(
        tmp,
        'write_file',
        JSON.stringify({ path: 'a/hello.txt', content: 'hello world', overwrite: true }),
      )
      assert.equal(forced.ok, true)

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

      const exact = await runTool(
        tmp,
        'replace_file',
        JSON.stringify({
          path: 'a/hello.txt',
          expected_content: 'hello enpii',
          content: 'exact replacement',
        }),
      )
      assert.equal(exact.ok, true)
      assert.equal(fs.readFileSync(path.join(tmp, 'a/hello.txt'), 'utf8'), 'exact replacement')

      const conflict = await runTool(
        tmp,
        'replace_file',
        JSON.stringify({
          path: 'a/hello.txt',
          expected_content: 'stale content',
          content: 'must not write',
        }),
      )
      assert.equal(conflict.ok, false)
      assert.match(conflict.content, /edit conflict/)
      assert.equal(fs.readFileSync(path.join(tmp, 'a/hello.txt'), 'utf8'), 'exact replacement')

      fs.writeFileSync(path.join(tmp, 'empty.txt'), '', 'utf8')
      const empty = await runTool(
        tmp,
        'replace_file',
        JSON.stringify({ path: 'empty.txt', expected_content: '', content: 'now filled' }),
      )
      assert.equal(empty.ok, true)
      assert.equal(fs.readFileSync(path.join(tmp, 'empty.txt'), 'utf8'), 'now filled')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
