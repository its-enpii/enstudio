import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { discoverProjectContext, projectContextPrompt } from './context.js'
import { projectHash } from './persist.js'

function fixture(): { root: string; home: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-context-'))
  const root = path.join(dir, 'project')
  const home = path.join(dir, 'home')
  fs.mkdirSync(path.join(root, '.enpii', 'skills'), { recursive: true })
  fs.mkdirSync(path.join(home, '.enpiistudio', 'skills'), { recursive: true })
  return { root, home, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('auto-briefs stub AGENT.md and injects snapshot', () => {
  const { root, home, cleanup } = fixture()
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'demo-app',
      scripts: { test: 'node test.js', build: 'tsc' },
      devDependencies: { typescript: '5' },
    }))
    fs.writeFileSync(
      path.join(root, '.enpii', 'AGENT.md'),
      '# Project agent instructions\n\nAdd durable project guidance for enpii here.\n',
    )
    fs.mkdirSync(path.join(root, 'src'))
    const context = discoverProjectContext(root, '', { homeDir: home, persist: false })
    assert.match(context.projectInstructions ?? '', /demo-app|Auto-generated|npm scripts|TypeScript/)
    assert.match(context.projectSnapshot ?? '', /demo-app/)
    assert.match(context.projectSnapshot ?? '', /test:/)
    const prompt = projectContextPrompt(context, { workspaceRoot: root, permissionMode: 'ask' })
    assert.match(prompt, /Project instructions/)
    // User edit must stick.
    fs.writeFileSync(path.join(root, '.enpii', 'AGENT.md'), 'Keep Indonesian replies.')
    const again = discoverProjectContext(root, '', { homeDir: home, persist: false })
    assert.equal(again.projectInstructions, 'Keep Indonesian replies.')
  } finally {
    cleanup()
  }
})

test('discovers AGENT.md and project skill overrides global skill', () => {
  const { root, home, cleanup } = fixture()
  try {
    fs.writeFileSync(path.join(root, '.enpii', 'AGENT.md'), 'Use Indonesian.\r\nKeep diffs small.')
    fs.writeFileSync(path.join(home, '.enpiistudio', 'skills', 'review.md'), `---\nname: review\ndescription: Global review\n---\nGLOBAL SECRET BODY`)
    fs.writeFileSync(path.join(root, '.enpii', 'skills', 'review.md'), `---\nname: review\ndescription: Project review\n---\nPROJECT REVIEW BODY`)
    fs.writeFileSync(path.join(root, '.enpii', 'skills', 'test.md'), '# Testing\nRun focused tests first.')

    const context = discoverProjectContext(root, '/skill review', { homeDir: home })
    assert.equal(context.projectInstructions, 'Use Indonesian.\nKeep diffs small.')
    assert.deepEqual(context.skills.map((skill) => [skill.name, skill.source]), [
      ['review', 'project'],
      ['test', 'project'],
    ])
    assert.deepEqual(context.loadedSkills, [{ name: 'review', body: 'PROJECT REVIEW BODY' }])
    assert.ok(context.fingerprint)

    const prompt = projectContextPrompt(context, { workspaceRoot: root, permissionMode: 'ask' })
    assert.match(prompt, /Project instructions/)
    assert.match(prompt, /Project review/)
    assert.match(prompt, /PROJECT REVIEW BODY/)
    assert.doesNotMatch(prompt, /GLOBAL SECRET BODY/)
    assert.doesNotMatch(prompt, /Run focused tests first/)

    const state = path.join(home, '.enpiistudio', 'projects', projectHash(root), 'context.json')
    assert.ok(fs.existsSync(state))
    const saved = JSON.parse(fs.readFileSync(state, 'utf8')) as { fingerprint?: string; skills?: unknown[] }
    assert.equal(saved.fingerprint, context.fingerprint)
    assert.equal(saved.skills?.length, 2)
  } finally {
    cleanup()
  }
})

test('does not follow skill or AGENT.md symlinks', () => {
  const { root, home, cleanup } = fixture()
  try {
    const outside = path.join(path.dirname(root), 'outside.md')
    fs.writeFileSync(outside, 'OUTSIDE SECRET')
    fs.symlinkSync(outside, path.join(root, '.enpii', 'AGENT.md'))
    fs.symlinkSync(outside, path.join(root, '.enpii', 'skills', 'outside.md'))

    const context = discoverProjectContext(root, '/skill outside', { homeDir: home, persist: false })
    assert.equal(context.projectInstructions, undefined)
    assert.equal(context.skills.length, 0)
    assert.equal(context.loadedSkills.length, 0)
  } finally {
    cleanup()
  }
})

test('ignores oversized local instructions', () => {
  const { root, home, cleanup } = fixture()
  try {
    fs.writeFileSync(path.join(root, '.enpii', 'AGENT.md'), 'x'.repeat(32_001))
    const context = discoverProjectContext(root, '', { homeDir: home, persist: false })
    assert.equal(context.projectInstructions, undefined)
  } finally {
    cleanup()
  }
})

test('loads capped global and project memory excerpts', () => {
  const { root, home, cleanup } = fixture()
  try {
    const hash = projectHash(root)
    fs.mkdirSync(path.join(home, '.enpiistudio', 'memory', 'global'), { recursive: true })
    fs.mkdirSync(path.join(home, '.enpiistudio', 'memory', 'projects', hash), { recursive: true })
    fs.writeFileSync(path.join(home, '.enpiistudio', 'memory', 'global', 'prefs.md'), 'Prefer short diffs.')
    fs.writeFileSync(path.join(home, '.enpiistudio', 'memory', 'projects', hash, 'notes.md'), 'Project uses pnpm.')
    const context = discoverProjectContext(root, '', { homeDir: home, persist: false })
    assert.match(context.memoryExcerpts ?? '', /Prefer short diffs/)
    assert.match(context.memoryExcerpts ?? '', /Project uses pnpm/)
    const prompt = projectContextPrompt(context, { workspaceRoot: root, permissionMode: 'ask' })
    assert.match(prompt, /Durable memory/)
    assert.match(prompt, /project\/notes\.md/)
  } finally {
    cleanup()
  }
})

test('memory write + search + ensureEnpiiDir', async () => {
  const { root, home, cleanup } = fixture()
  try {
    const { memoryWrite, memorySearch, ensureEnpiiDir } = await import('./context.js')
    const wrote = memoryWrite(root, {
      name: 'api-notes',
      content: 'Use pnpm workspaces.\nPrefer short diffs.',
      scope: 'project',
      homeDir: home,
    })
    assert.equal(wrote.ok, true)
    const hit = memorySearch(root, { query: 'pnpm', homeDir: home })
    assert.equal(hit.ok, true)
    assert.match(hit.content, /api-notes/)
    const scaffold = ensureEnpiiDir(root)
    assert.equal(scaffold.created, true)
    assert.ok(fs.existsSync(path.join(root, '.enpii', 'AGENT.md')))
    assert.ok(fs.existsSync(path.join(root, '.enpii', 'skills')))
  } finally {
    cleanup()
  }
})

test('memory search ranks name hits above body-only', async () => {
  const { root, home, cleanup } = fixture()
  try {
    const { memoryWrite, memorySearch } = await import('./context.js')
    memoryWrite(root, { name: 'other', content: 'mentions ranking-token once', scope: 'global', homeDir: home })
    memoryWrite(root, { name: 'ranking-token', content: 'unrelated body', scope: 'project', homeDir: home })
    const hit = memorySearch(root, { query: 'ranking-token', homeDir: home })
    assert.equal(hit.ok, true)
    const lines = hit.content.split('\n').filter(Boolean)
    assert.ok(lines[0]?.includes('ranking-token.md'), hit.content)
  } finally {
    cleanup()
  }
})

test('memory delete removes note', async () => {
  const { root, home, cleanup } = fixture()
  try {
    const { memoryWrite, memoryDelete, memorySearch } = await import('./context.js')
    assert.equal(
      memoryWrite(root, { name: 'temp-note', content: 'ephemeral', scope: 'project', homeDir: home }).ok,
      true,
    )
    assert.equal(memoryDelete(root, { name: 'temp-note', scope: 'project', homeDir: home }).ok, true)
    const miss = memoryDelete(root, { name: 'temp-note', scope: 'project', homeDir: home })
    assert.equal(miss.ok, false)
    const hit = memorySearch(root, { query: 'ephemeral', homeDir: home })
    assert.equal(hit.content, '(no matches)')
  } finally {
    cleanup()
  }
})
