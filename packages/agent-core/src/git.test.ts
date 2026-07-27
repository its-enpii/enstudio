import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gitApplyStash, gitBranches, gitCommit, gitCommitDiff, gitCommitFiles, gitCommitSuggestion, gitConflicts, gitCreateBranch, gitDeleteBranch, gitDiff, gitDiscard, gitRemotes, gitRenameBranch, gitResolveConflict, gitStage, gitStageAll, gitStashAndSwitch, gitStashes, gitStatus, gitSwitchBranch, gitUnstage, gitUnstageAll } from './git.js'

function git(root: string, ...args: string[]): void {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

test('git workflow status diff stage unstage discard commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-git-'))
  try {
    git(root, 'init')
    git(root, 'config', 'user.name', 'enpii test')
    git(root, 'config', 'user.email', 'test@enpii.local')
    fs.writeFileSync(path.join(root, 'note.txt'), 'one\n', 'utf8')
    git(root, 'add', 'note.txt')
    git(root, 'commit', '-m', 'initial')
    const baseBranch = gitStatus(root).branch
    git(root, 'remote', 'add', 'origin', 'https://example.invalid/enpii.git')
    assert.equal(gitRemotes(root)[0]?.name, 'origin')

    fs.writeFileSync(path.join(root, 'note.txt'), 'one\ntwo\n', 'utf8')
    assert.equal(gitStatus(root).files[0]?.unstaged, true)
    assert.match(gitDiff(root, 'note.txt'), /\+two/)

    gitStageAll(root)
    assert.equal(gitStatus(root).files[0]?.staged, true)
    gitUnstageAll(root)
    assert.equal(gitStatus(root).files[0]?.unstaged, true)

    gitStage(root, 'note.txt')
    assert.equal(gitStatus(root).files[0]?.staged, true)
    gitUnstage(root, 'note.txt')
    assert.equal(gitStatus(root).files[0]?.unstaged, true)
    gitDiscard(root, 'note.txt', false)
    assert.equal(fs.readFileSync(path.join(root, 'note.txt'), 'utf8'), 'one\n')

    fs.writeFileSync(path.join(root, 'new.txt'), 'new\n', 'utf8')
    gitStage(root, 'new.txt')
    assert.equal(gitCommitSuggestion(root), 'Add new.txt')
    assert.match(gitCommit(root, 'add new'), /add new/)
    const hash = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    assert.deepEqual(gitCommitFiles(root, hash), [{ path: 'new.txt', status: 'A' }])
    assert.match(gitCommitDiff(root, hash, 'new.txt'), /new\.txt/)
    assert.equal(gitStatus(root).files.length, 0)

    gitCreateBranch(root, 'feature/test')
    assert.equal(gitBranches(root).find((branch) => branch.current)?.name, 'feature/test')
    gitRenameBranch(root, 'feature/test', 'feature/renamed')
    gitSwitchBranch(root, baseBranch)
    gitDeleteBranch(root, 'feature/renamed')
    assert.equal(gitBranches(root).some((branch) => branch.name === 'feature/renamed'), false)

    gitCreateBranch(root, 'feature/stash-target')
    gitSwitchBranch(root, baseBranch)
    fs.writeFileSync(path.join(root, 'note.txt'), 'stashed\n', 'utf8')
    gitStashAndSwitch(root, 'feature/stash-target')
    assert.equal(gitStatus(root).branch, 'feature/stash-target')
    assert.equal(gitStatus(root).files.length, 0)
    assert.equal(gitStashes(root).length, 1)
    gitApplyStash(root, 'stash@{0}', true)
    assert.equal(gitStashes(root).length, 0)
    assert.equal(gitStatus(root).files[0]?.path, 'note.txt')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('git conflict inspection and resolution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-conflict-'))
  try {
    git(root, 'init')
    git(root, 'config', 'user.name', 'enpii test')
    git(root, 'config', 'user.email', 'test@enpii.local')
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'base\n', 'utf8')
    git(root, 'add', 'conflict.txt')
    git(root, 'commit', '-m', 'base')
    const base = gitStatus(root).branch
    git(root, 'switch', '-c', 'incoming')
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'incoming\n', 'utf8')
    git(root, 'commit', '-am', 'incoming')
    git(root, 'switch', base)
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'current\n', 'utf8')
    git(root, 'commit', '-am', 'current')
    const merge = spawnSync('git', ['-C', root, 'merge', 'incoming'], { encoding: 'utf8' })
    assert.notEqual(merge.status, 0)

    const conflict = gitConflicts(root)[0]
    assert.equal(conflict?.path, 'conflict.txt')
    assert.match(conflict?.ours ?? '', /current/)
    assert.match(conflict?.theirs ?? '', /incoming/)
    gitResolveConflict(root, 'conflict.txt', 'ours')
    assert.equal(gitConflicts(root).length, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
