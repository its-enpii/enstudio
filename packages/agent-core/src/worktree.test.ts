import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  gitWorktreeAdd,
  gitWorktreeApply,
  gitWorktreeDiscard,
  gitWorktreeList,
  gitWorktreePreview,
  gitWorktreeRemove,
} from './git.js'
import { SessionStore } from './session.js'
import { projectHash } from './persist.js'

function git(root: string, ...args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

test('git worktree add list remove under managed home', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-wt-'))
  try {
    git(root, 'init')
    git(root, 'config', 'user.name', 'enpii test')
    git(root, 'config', 'user.email', 'test@enpii.local')
    fs.writeFileSync(path.join(root, 'note.txt'), 'one\n', 'utf8')
    git(root, 'add', 'note.txt')
    git(root, 'commit', '-m', 'initial')

    const before = gitWorktreeList(root)
    assert.equal(before.some((wt) => wt.main), true)

    const created = gitWorktreeAdd(root, { name: 'try-one' })
    assert.equal(created.main, false)
    assert.equal(created.branch, 'enpii/try-one')
    assert.equal(fs.existsSync(path.join(created.path, 'note.txt')), true)
    assert.ok(created.path.includes(path.join('.enpiistudio', 'worktrees', projectHash(root))))

    const listed = gitWorktreeList(root)
    assert.equal(listed.some((wt) => path.resolve(wt.path) === path.resolve(created.path)), true)

    const remaining = gitWorktreeRemove(root, created.path, true)
    assert.equal(remaining.some((wt) => path.resolve(wt.path) === path.resolve(created.path)), false)
    assert.equal(fs.existsSync(created.path), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('worktree preview apply and discard', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-wt-apply-'))
  try {
    git(root, 'init')
    git(root, 'config', 'user.name', 'enpii test')
    git(root, 'config', 'user.email', 'test@enpii.local')
    fs.writeFileSync(path.join(root, 'note.txt'), 'one\n', 'utf8')
    git(root, 'add', 'note.txt')
    git(root, 'commit', '-m', 'initial')

    const created = gitWorktreeAdd(root, { name: 'try-apply' })
    fs.writeFileSync(path.join(created.path, 'note.txt'), 'one\ntwo\n', 'utf8')
    git(created.path, 'add', 'note.txt')
    git(created.path, 'commit', '-m', 'worktree change')

    const preview = gitWorktreePreview(root, created.path)
    assert.equal(preview.ahead, 1)
    assert.equal(preview.dirty, false)
    assert.match(preview.diff, /\+two/)
    assert.equal(preview.files.some((f) => f.path === 'note.txt'), true)

    const applied = gitWorktreeApply(root, created.path, { remove: true })
    assert.equal(applied.removed, true)
    assert.equal(fs.readFileSync(path.join(root, 'note.txt'), 'utf8'), 'one\ntwo\n')
    assert.equal(fs.existsSync(created.path), false)

    const keep = gitWorktreeAdd(root, { name: 'try-keep' })
    fs.writeFileSync(path.join(keep.path, 'note.txt'), 'one\ntwo\nthree\n', 'utf8')
    git(keep.path, 'add', 'note.txt')
    git(keep.path, 'commit', '-m', 'keep branch change')
    const kept = gitWorktreeApply(root, keep.path, { remove: true, keepBranch: true })
    assert.equal(kept.removed, true)
    assert.equal(kept.keptBranch, 'enpii/try-keep')
    assert.match(git(root, 'branch').stdout, /enpii\/try-keep/)

    const second = gitWorktreeAdd(root, { name: 'try-discard' })
    fs.writeFileSync(path.join(second.path, 'extra.txt'), 'x\n', 'utf8')
    const discarded = gitWorktreeDiscard(root, second.path)
    assert.equal(fs.existsSync(second.path), false)
    assert.equal(discarded.deletedBranch, 'enpii/try-discard')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('worktree apply returns conflicts without removing worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-wt-conflict-'))
  try {
    git(root, 'init')
    git(root, 'config', 'user.name', 'enpii test')
    git(root, 'config', 'user.email', 'test@enpii.local')
    fs.writeFileSync(path.join(root, 'note.txt'), 'base\n', 'utf8')
    git(root, 'add', 'note.txt')
    git(root, 'commit', '-m', 'initial')

    const created = gitWorktreeAdd(root, { name: 'try-conflict' })
    fs.writeFileSync(path.join(created.path, 'note.txt'), 'worktree\n', 'utf8')
    git(created.path, 'add', 'note.txt')
    git(created.path, 'commit', '-m', 'worktree edit')

    fs.writeFileSync(path.join(root, 'note.txt'), 'main\n', 'utf8')
    git(root, 'add', 'note.txt')
    git(root, 'commit', '-m', 'main edit')

    const applied = gitWorktreeApply(root, created.path, { remove: true })
    assert.ok(applied.conflicts?.length)
    assert.equal(applied.removed, false)
    assert.equal(fs.existsSync(created.path), true)
    assert.equal(applied.conflicts![0]?.path, 'note.txt')
    // leave main conflicted state clean for tmp cleanup
    git(root, 'merge', '--abort')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('worktree session stores under base project hash and lists with main', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-base-'))
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-linked-'))
  try {
    const store = new SessionStore()
    const meta = store.create({
      projectRoot: wt,
      baseProjectRoot: base,
      worktreeBranch: 'enpii/try',
      title: 'Worktree · enpii/try',
    })
    assert.equal(meta.baseProjectRoot && path.resolve(meta.baseProjectRoot), path.resolve(base))
    assert.equal(meta.worktreeBranch, 'enpii/try')

    // Empty worktree sessions stay listed so Linked worktrees can re-open them.
    const listed = store.list(base)
    assert.equal(listed.some((s) => s.id === meta.id), true)

    store.setMessages(meta.id, [{ role: 'user', content: 'hi' }])
    const again = store.list(base)
    assert.equal(again.some((s) => s.id === meta.id), true)
    const hit = again.find((s) => s.id === meta.id)!
    assert.equal(path.resolve(hit.projectRoot), path.resolve(wt))
    assert.equal(path.resolve(hit.baseProjectRoot!), path.resolve(base))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
    fs.rmSync(wt, { recursive: true, force: true })
  }
})

test('discard is idempotent when git worktree already gone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-wt-orphan-'))
  try {
    git(root, 'init')
    git(root, 'config', 'user.name', 'enpii test')
    git(root, 'config', 'user.email', 'test@enpii.local')
    fs.writeFileSync(path.join(root, 'a.txt'), 'a\n', 'utf8')
    git(root, 'add', 'a.txt')
    git(root, 'commit', '-m', 'initial')

    const created = gitWorktreeAdd(root, { name: 'orphan-me' })
    const branch = created.branch
    gitWorktreeRemove(root, created.path, true)
    assert.equal(gitWorktreeList(root).some((w) => path.resolve(w.path) === path.resolve(created.path)), false)

    const d = gitWorktreeDiscard(root, created.path, { branchHint: branch })
    assert.equal(d.alreadyGone, true)
    // second discard still ok
    const d2 = gitWorktreeDiscard(root, created.path, { branchHint: branch })
    assert.equal(d2.alreadyGone, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
