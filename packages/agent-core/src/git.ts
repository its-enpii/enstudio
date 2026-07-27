import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectHash } from './persist.js'
import { resolveInRoot } from './tools/paths.js'

export interface GitFileStatus {
  path: string
  index: string
  worktree: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

export interface GitStatus {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

export interface GitCommitFile {
  path: string
  status: string
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
  upstream?: string
}

export interface GitStash {
  ref: string
  message: string
  branch: string
  date: string
}

export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface GitTag {
  name: string
  hash: string
  shortHash: string
  subject: string
  date: string
  annotated: boolean
}

export interface GitConflict {
  path: string
  base: string
  ours: string
  theirs: string
}

function runGit(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', path.resolve(root), ...args], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git exited ${result.status}`).trim())
  }
  return result.stdout
}

function safePath(root: string, file: string): string {
  const value = file.trim()
  if (!value) throw new Error('path is required')
  resolveInRoot(root, value)
  return value.replace(/\\/g, '/')
}

function safeBranch(root: string, branch: string): string {
  const value = branch.trim()
  if (!value) throw new Error('branch name is required')
  return runGit(root, ['check-ref-format', '--branch', value]).trim()
}

function assertClean(root: string): void {
  if (gitStatus(root).files.length > 0) throw new Error('Commit or discard working tree changes before switching branches')
}

function safeStashRef(ref: string): string {
  const value = ref.trim()
  if (!/^stash@\{\d+\}$/.test(value)) throw new Error('invalid stash reference')
  return value
}

function safeRemote(remote: string): string {
  const value = remote.trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('invalid remote name')
  return value
}

function safeTag(root: string, tag: string): string {
  const value = tag.trim()
  if (!value || value.startsWith('-') || value.includes('..') || /[\s~^:?*[\\]/.test(value)) throw new Error('invalid tag name')
  runGit(root, ['check-ref-format', `refs/tags/${value}`])
  return value
}

export function gitStatus(root: string): GitStatus {
  const lines = runGit(root, ['status', '--porcelain=v1', '--branch'])
    .split(/\r?\n/)
    .filter(Boolean)
  const header = lines.shift() ?? '## HEAD'
  const branchText = header.replace(/^##\s*/, '')
  const relation = branchText.match(/^(.*?)\.\.\.([^\s]+)(?:\s+\[(.*?)\])?$/)
  const unborn = branchText.match(/^(?:No commits yet|Initial commit) on (.+)$/)
  const branch = (unborn?.[1] ?? relation?.[1] ?? branchText.split(/\s+/)[0] ?? 'HEAD').trim()
  const state = relation?.[3] ?? ''
  const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
  const files = lines.map((line) => {
    const code = line.slice(0, 2)
    const rawPath = line.slice(3).trim()
    const file = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1)! : rawPath
    return {
      path: file.replace(/^"|"$/g, ''),
      index: code[0] ?? ' ',
      worktree: code[1] ?? ' ',
      staged: code[0] !== ' ' && code[0] !== '?',
      unstaged: code[1] !== ' ' || code === '??',
      untracked: code === '??',
      conflicted: conflicts.has(code),
    }
  })
  return {
    branch,
    upstream: relation?.[2],
    ahead: Number(state.match(/ahead\s+(\d+)/)?.[1] ?? 0),
    behind: Number(state.match(/behind\s+(\d+)/)?.[1] ?? 0),
    files,
  }
}

export function gitDiff(root: string, file?: string, staged = false): string {
  return runGit(root, [
    'diff',
    '--no-ext-diff',
    '--unified=3',
    ...(staged ? ['--cached'] : []),
    '--',
    ...(file ? [safePath(root, file)] : []),
  ])
}

export function gitStage(root: string, file: string): void {
  runGit(root, ['add', '--', safePath(root, file)])
}

export function gitStageAll(root: string): void {
  runGit(root, ['add', '--all'])
}

export function gitUnstage(root: string, file: string): void {
  const target = safePath(root, file)
  try {
    runGit(root, ['restore', '--staged', '--', target])
  } catch {
    runGit(root, ['rm', '--cached', '--ignore-unmatch', '--', target])
  }
}

export function gitUnstageAll(root: string): void {
  try {
    runGit(root, ['restore', '--staged', ':/'])
  } catch {
    runGit(root, ['rm', '--cached', '-r', '--ignore-unmatch', '.'])
  }
}

export function gitDiscard(root: string, file: string, untracked: boolean): void {
  const target = safePath(root, file)
  if (untracked) {
    fs.rmSync(resolveInRoot(root, target), { recursive: true, force: true })
    return
  }
  runGit(root, ['restore', '--worktree', '--', target])
}

export function gitCommit(root: string, message: string): string {
  const value = message.trim()
  if (!value) throw new Error('commit message is required')
  return runGit(root, ['commit', '-m', value]).trim()
}

export function gitCommitSuggestion(root: string): string {
  const files = gitStatus(root).files.filter((file) => file.staged)
  if (files.length === 0) throw new Error('stage changes before generating a commit message')
  const names = files.map((file) => path.basename(file.path)).slice(0, 2)
  const suffix = files.length > 2 ? ` and ${files.length - 2} more` : ''
  if (files.every((file) => file.untracked || file.index === 'A')) return `Add ${names.join(', ')}${suffix}`
  if (files.every((file) => file.index === 'D')) return `Remove ${names.join(', ')}${suffix}`
  if (files.length === 1) return `Update ${names[0]}`
  return `Update ${names.join(', ')}${suffix}`
}

export function gitHistory(root: string, limit = 50): GitCommit[] {
  try {
    return runGit(root, [
      'log',
      `-n${Math.min(Math.max(limit, 1), 100)}`,
      '--date=iso-strict',
      '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e',
    ])
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, author, date, subject] = record.split('\x1f')
        return { hash, shortHash, author, date, subject }
      })
  } catch (error) {
    if (String(error).toLowerCase().includes('does not have any commits')) return []
    throw error
  }
}

export function gitCommitFiles(root: string, hash: string): GitCommitFile[] {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('invalid commit hash')
  return runGit(root, ['show', '--format=', '--name-status', '--find-renames', hash, '--'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status = 'M', ...paths] = line.split('\t')
      return { status: status[0] ?? 'M', path: paths.at(-1) ?? '' }
    })
    .filter((file) => file.path)
}

export function gitCommitDiff(root: string, hash: string, file?: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('invalid commit hash')
  return runGit(root, [
    'show',
    '--format=',
    '--no-ext-diff',
    '--unified=3',
    hash,
    '--',
    ...(file ? [safePath(root, file)] : []),
  ])
}

export function gitBranches(root: string): GitBranch[] {
  const branches: GitBranch[] = runGit(root, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%09%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(symref)',
    'refs/heads',
    'refs/remotes',
  ])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [ref = '', name = '', head = '', upstream = '', symref = ''] = line.split('\t')
      return { ref, name, head, upstream, symref }
    })
    .filter((branch) => branch.name && !branch.symref)
    .map((branch) => ({
      name: branch.name,
      current: branch.head === '*',
      remote: branch.ref.startsWith('refs/remotes/'),
      upstream: branch.upstream || undefined,
    }))
  if (!branches.some((branch) => branch.current)) {
    const branch = gitStatus(root).branch
    if (branch && branch !== 'HEAD') branches.unshift({ name: branch, current: true, remote: false })
  }
  return branches
}

export function gitCreateBranch(root: string, name: string): void {
  assertClean(root)
  runGit(root, ['switch', '-c', safeBranch(root, name)])
}

export function gitSwitchBranch(root: string, name: string, remote = false): void {
  assertClean(root)
  const branch = safeBranch(root, name)
  runGit(root, remote ? ['switch', '--track', branch] : ['switch', branch])
}

export function gitRenameBranch(root: string, oldName: string, newName: string): void {
  runGit(root, ['branch', '-m', safeBranch(root, oldName), safeBranch(root, newName)])
}

export function gitDeleteBranch(root: string, name: string): void {
  runGit(root, ['branch', '-d', safeBranch(root, name)])
}

export function gitStashes(root: string): GitStash[] {
  return runGit(root, ['stash', 'list', '--format=%gd%x1f%gs%x1f%ci'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [ref = '', subject = '', date = ''] = line.split('\x1f')
      const branch = subject.match(/^(?:WIP )?[Oo]n ([^:]+):/)?.[1] ?? ''
      const message = subject.replace(/^(?:WIP )?[Oo]n [^:]+:\s*/, '')
      return { ref, message, branch, date }
    })
}

export function gitCreateStash(root: string, message: string, includeUntracked = false): void {
  const files = gitStatus(root).files
  if (files.length === 0) throw new Error('working tree is clean')
  if (!includeUntracked && files.every((file) => file.untracked)) throw new Error('enable includeUntracked to stash new files')
  const value = message.trim() || 'enpii stash'
  runGit(root, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), '-m', value])
}

export function gitApplyStash(root: string, ref: string, pop = false): void {
  runGit(root, ['stash', pop ? 'pop' : 'apply', safeStashRef(ref)])
}

export function gitDropStash(root: string, ref: string): void {
  runGit(root, ['stash', 'drop', safeStashRef(ref)])
}

export function gitStashAndSwitch(root: string, name: string, remote = false, includeUntracked = true): void {
  gitCreateStash(root, `Before switching to ${name}`, includeUntracked)
  gitSwitchBranch(root, name, remote)
}

export function gitRemotes(root: string): GitRemote[] {
  const map = new Map<string, GitRemote>()
  for (const line of runGit(root, ['remote', '-v']).split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!match) continue
    const [, name, url, kind] = match
    const existing = map.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
    if (kind === 'fetch') existing.fetchUrl = url
    else existing.pushUrl = url
    map.set(name, existing)
  }
  return [...map.values()]
}

export function gitTags(root: string): GitTag[] {
  return runGit(root, [
    'for-each-ref',
    '--sort=-creatordate',
    '--format=%(refname:short)%09%(objectname)%09%(objectname:short)%09%(subject)%09%(creatordate:iso-strict)%09%(objecttype)',
    'refs/tags',
  ])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = '', hash = '', shortHash = '', subject = '', date = '', objectType = 'commit'] = line.split('\t')
      return { name, hash, shortHash, subject, date, annotated: objectType === 'tag' }
    })
}

export function gitCreateTag(root: string, name: string, message?: string, target = 'HEAD'): void {
  const tag = safeTag(root, name)
  if (!/^(HEAD|[0-9a-f]{7,40})$/i.test(target.trim())) throw new Error('invalid tag target')
  const args = message?.trim() ? ['tag', '-a', tag, target.trim(), '-m', message.trim()] : ['tag', tag, target.trim()]
  runGit(root, args)
}

export function gitDeleteTag(root: string, name: string): void {
  runGit(root, ['tag', '-d', safeTag(root, name)])
}

export function gitPushTag(root: string, name: string, remote = 'origin'): void {
  const tag = safeTag(root, name)
  runGit(root, ['push', safeRemote(remote), `refs/tags/${tag}`])
}

export interface GitReleaseResult {
  tag: string
  remote: string
  target: string
  annotated: boolean
  pushed: boolean
  githubUrl?: string
  githubSkipped?: string
}

/** Annotated tag + push; optional GitHub release via `gh` when available. */
export function gitRelease(
  root: string,
  opts: {
    name: string
    message?: string
    target?: string
    remote?: string
    github?: boolean
  },
): GitReleaseResult {
  const tag = safeTag(root, opts.name)
  const target = (opts.target ?? 'HEAD').trim() || 'HEAD'
  if (!/^(HEAD|[0-9a-f]{7,40})$/i.test(target)) throw new Error('invalid tag target')
  const remote = safeRemote(opts.remote ?? gitRemotes(root)[0]?.name ?? 'origin')
  const notes = opts.message?.trim() || tag
  // releases always annotated so notes travel with the tag
  runGit(root, ['tag', '-a', tag, target, '-m', notes])
  runGit(root, ['push', remote, `refs/tags/${tag}`])

  let githubUrl: string | undefined
  let githubSkipped: string | undefined
  if (opts.github !== false) {
    const title = notes.split(/\r?\n/, 1)[0] || tag
    const body = notes.includes('\n') ? notes : undefined
    const gh = spawnSync(
      'gh',
      [
        'release',
        'create',
        tag,
        // gh resolves repo from git remote in cwd
        '--title',
        title,
        ...(body ? ['--notes', body] : ['--generate-notes']),
      ],
      {
        cwd: path.resolve(root),
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true,
      },
    )
    if (gh.error || gh.status !== 0) {
      const detail = (gh.stderr || gh.stdout || gh.error?.message || 'gh release failed').trim()
      // no gh / not a github remote — tag push still counts as release artifact
      githubSkipped = detail.slice(0, 240)
    } else {
      githubUrl = (gh.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1)
    }
  }

  return {
    tag,
    remote,
    target,
    annotated: true,
    pushed: true,
    githubUrl,
    githubSkipped,
  }
}

export function gitFetch(root: string, remote?: string): void {
  runGit(root, ['fetch', ...(remote ? [safeRemote(remote)] : [])])
}

export function gitPull(root: string, remote?: string, branch?: string): void {
  assertClean(root)
  if (branch && !remote) throw new Error('remote is required when branch is provided')
  const args = ['pull', '--ff-only']
  if (remote) args.push(safeRemote(remote))
  if (branch) args.push(safeBranch(root, branch))
  runGit(root, args)
}

export function gitPush(root: string, remote?: string, branch?: string, setUpstream = false): void {
  if (setUpstream && (!remote || !branch)) throw new Error('remote and branch are required when setting upstream')
  const args = ['push']
  if (setUpstream) args.push('--set-upstream')
  if (remote) args.push(safeRemote(remote))
  if (branch) args.push(safeBranch(root, branch))
  runGit(root, args)
}

function readConflictStage(root: string, stage: 1 | 2 | 3, file: string): string {
  try {
    return runGit(root, ['show', `:${stage}:${safePath(root, file)}`])
  } catch {
    return ''
  }
}

export function gitConflict(root: string, file: string): GitConflict {
  const target = safePath(root, file)
  const status = gitStatus(root).files.find((entry) => entry.path === target)
  if (!status?.conflicted) throw new Error('file is not conflicted')
  return {
    path: target,
    base: readConflictStage(root, 1, target),
    ours: readConflictStage(root, 2, target),
    theirs: readConflictStage(root, 3, target),
  }
}

export function gitConflicts(root: string): GitConflict[] {
  return gitStatus(root).files.filter((file) => file.conflicted).map((file) => gitConflict(root, file.path))
}

export function gitResolveConflict(root: string, file: string, resolution: 'ours' | 'theirs' | 'mark'): void {
  const target = safePath(root, file)
  const status = gitStatus(root).files.find((entry) => entry.path === target)
  if (!status?.conflicted) throw new Error('file is not conflicted')
  if (resolution === 'mark') runGit(root, ['add', '--', target])
  else {
    runGit(root, ['checkout', `--${resolution}`, '--', target])
    runGit(root, ['add', '--', target])
  }
}

export interface GitWorktree {
  path: string
  head: string
  branch?: string
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
  main: boolean
}

function worktreeHome(mainRoot: string): string {
  return path.join(os.homedir(), '.enpiistudio', 'worktrees', projectHash(mainRoot))
}

function safeWorktreeSlug(name: string): string {
  const value = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!value || value === '.' || value === '..') throw new Error('invalid worktree name')
  if (value.length > 64) throw new Error('worktree name too long')
  return value
}

/** Main checkout path for this repo (works when `root` is already a linked worktree). */
function mainWorktreeRoot(root: string): string {
  const common = runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  if (path.basename(common) === '.git') return path.resolve(path.dirname(common))
  return path.resolve(common)
}

function parseWorktreeList(root: string): GitWorktree[] {
  const primary = mainWorktreeRoot(root)
  const raw = runGit(root, ['worktree', 'list', '--porcelain'])
  const blocks = raw.split(/\n(?=worktree )/g).map((b) => b.trim()).filter(Boolean)
  return blocks.map((block) => {
    const lines = block.split(/\r?\n/)
    const get = (key: string) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1)
    const wtPath = path.resolve(get('worktree') ?? '')
    const branchRef = get('branch')
    const branch = branchRef?.replace(/^refs\/heads\//, '')
    return {
      path: wtPath,
      head: get('HEAD') ?? '',
      branch,
      bare: lines.includes('bare'),
      detached: lines.includes('detached'),
      locked: lines.some((l) => l.startsWith('locked')),
      prunable: lines.some((l) => l.startsWith('prunable')),
      main: path.resolve(wtPath) === primary,
    }
  }).filter((wt) => wt.path)
}

export function gitWorktreeList(root: string): GitWorktree[] {
  return parseWorktreeList(root)
}

export function gitWorktreeAdd(
  root: string,
  opts: { name?: string; branch?: string; startPoint?: string } = {},
): GitWorktree {
  const primary = mainWorktreeRoot(root)
  const slug = safeWorktreeSlug(opts.name ?? `attempt-${Date.now().toString(36)}`)
  const dir = path.join(worktreeHome(primary), slug)
  if (fs.existsSync(dir)) throw new Error(`worktree path already exists: ${dir}`)
  fs.mkdirSync(path.dirname(dir), { recursive: true })

  const branch = opts.branch?.trim()
    ? safeBranch(primary, opts.branch)
    : safeBranch(primary, `enpii/${slug}`)
  const start = (opts.startPoint ?? 'HEAD').trim() || 'HEAD'
  if (!/^[A-Za-z0-9._/\-{}@]+$/.test(start)) throw new Error('invalid start point')

  runGit(primary, ['worktree', 'add', '-b', branch, dir, start])
  const created = parseWorktreeList(primary).find((wt) => path.resolve(wt.path) === path.resolve(dir))
  if (!created) throw new Error('worktree created but not listed')
  return created
}

export function gitWorktreeRemove(root: string, worktreePath: string, force = false): GitWorktree[] {
  const primary = mainWorktreeRoot(root)
  const listed = parseWorktreeList(primary)
  const target = path.resolve(worktreePath)
  const entry = listed.find((wt) => path.resolve(wt.path) === target)
  if (!entry) throw new Error('worktree not found')
  if (entry.main) throw new Error('cannot remove main worktree')

  const home = path.resolve(worktreeHome(primary))
  if (!force && !target.startsWith(home + path.sep) && target !== home) {
    throw new Error('refusing to remove unmanaged worktree (pass force)')
  }

  runGit(primary, force ? ['worktree', 'remove', '--force', target] : ['worktree', 'remove', target])
  try {
    runGit(primary, ['worktree', 'prune'])
  } catch {
    /* ignore */
  }
  return parseWorktreeList(primary)
}

function resolveLinkedWorktree(root: string, worktreePath: string): { primary: string; entry: GitWorktree } {
  const primary = mainWorktreeRoot(root)
  const target = path.resolve(worktreePath)
  const entry = parseWorktreeList(primary).find((wt) => path.resolve(wt.path) === target)
  if (!entry) {
    throw new Error(
      `worktree not found: ${target} — git tree already removed; Discard archives the orphan session`,
    )
  }
  if (entry.main) throw new Error('main worktree has nothing to apply back')
  return { primary, entry }
}

export interface GitWorktreePreview {
  path: string
  branch?: string
  head: string
  baseBranch: string
  dirty: boolean
  ahead: number
  commits: { shortHash: string; subject: string }[]
  files: { path: string; status: string }[]
  diff: string
}

/** Diff + commit list of worktree tip vs main HEAD (three-dot). */
export function gitWorktreePreview(root: string, worktreePath: string): GitWorktreePreview {
  const { primary, entry } = resolveLinkedWorktree(root, worktreePath)
  const ref = entry.branch ?? entry.head
  if (!ref) throw new Error('worktree has no branch or HEAD')
  const dirty = gitStatus(entry.path).files.length > 0
  const baseBranch = gitStatus(primary).branch
  const commits = runGit(primary, [
    'log',
    '--format=%h%x1f%s%x1e',
    `HEAD..${ref}`,
  ])
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [shortHash = '', subject = ''] = r.split('\x1f')
      return { shortHash, subject }
    })
  const nameStatus = runGit(primary, ['diff', '--name-status', `HEAD...${ref}`])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status = 'M', ...paths] = line.split('\t')
      return { status: status[0] ?? 'M', path: paths.at(-1) ?? '' }
    })
    .filter((f) => f.path)
  const diff = runGit(primary, ['diff', '--no-ext-diff', '--unified=3', `HEAD...${ref}`])
  return {
    path: entry.path,
    branch: entry.branch,
    head: entry.head,
    baseBranch,
    dirty,
    ahead: commits.length,
    commits,
    files: nameStatus,
    diff,
  }
}

/** Merge worktree tip into main checkout. Main + worktree must be clean. */
export function gitWorktreeApply(
  root: string,
  worktreePath: string,
  opts: { remove?: boolean; keepBranch?: boolean } = {},
): {
  merged: string
  status: GitStatus
  removed: boolean
  worktrees: GitWorktree[]
  conflicts?: GitConflict[]
  keptBranch?: string
} {
  const { primary, entry } = resolveLinkedWorktree(root, worktreePath)
  assertClean(primary)
  if (gitStatus(entry.path).files.length > 0) {
    throw new Error('Commit or discard worktree changes before apply')
  }
  const ref = entry.branch ?? entry.head
  if (!ref) throw new Error('worktree has no branch or HEAD')
  const ahead = runGit(primary, ['rev-list', '--count', `HEAD..${ref}`]).trim()
  if (ahead === '0') throw new Error('nothing to apply: worktree is not ahead of main')

  try {
    runGit(primary, ['merge', '--no-edit', ref])
  } catch (err) {
    const conflicts = gitConflicts(primary)
    if (conflicts.length) {
      return {
        merged: ref,
        status: gitStatus(primary),
        removed: false,
        worktrees: parseWorktreeList(primary),
        conflicts,
      }
    }
    throw err
  }
  let worktrees = parseWorktreeList(primary)
  let removed = false
  let keptBranch: string | undefined
  if (opts.remove) {
    worktrees = gitWorktreeRemove(primary, entry.path, true)
    removed = true
    if (entry.branch?.startsWith('enpii/')) {
      if (opts.keepBranch) {
        keptBranch = entry.branch
      } else {
        try {
          runGit(primary, ['branch', '-D', entry.branch])
        } catch {
          keptBranch = entry.branch
        }
      }
    }
  }
  return { merged: ref, status: gitStatus(primary), removed, worktrees, keptBranch }
}

/** Force-remove worktree; optionally delete enpii/* branch. Idempotent if tree already gone. */
export function gitWorktreeDiscard(
  root: string,
  worktreePath: string,
  opts: { deleteBranch?: boolean; branchHint?: string } = {},
): { worktrees: GitWorktree[]; deletedBranch?: string; alreadyGone?: boolean } {
  const primary = mainWorktreeRoot(root)
  const target = path.resolve(worktreePath)
  const listed = parseWorktreeList(primary)
  const entry = listed.find((wt) => path.resolve(wt.path) === target)

  if (!entry) {
    try {
      runGit(primary, ['worktree', 'prune'])
    } catch {
      /* */
    }
    let deletedBranch: string | undefined
    const hint = (opts.branchHint ?? '').replace(/^refs\/heads\//, '')
    if (opts.deleteBranch !== false && hint.startsWith('enpii/')) {
      try {
        runGit(primary, ['branch', '-D', hint])
        deletedBranch = hint
      } catch {
        /* */
      }
    }
    // Drop leftover dir under managed home if present.
    try {
      const home = path.resolve(worktreeHome(primary))
      if (target.startsWith(home + path.sep) && fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true })
      }
    } catch {
      /* */
    }
    return { worktrees: parseWorktreeList(primary), deletedBranch, alreadyGone: true }
  }
  if (entry.main) throw new Error('cannot discard main worktree')

  const worktrees = gitWorktreeRemove(primary, entry.path, true)
  let deletedBranch: string | undefined
  if (opts.deleteBranch !== false && entry.branch?.startsWith('enpii/')) {
    try {
      runGit(primary, ['branch', '-D', entry.branch])
      deletedBranch = entry.branch
    } catch {
      /* ignore */
    }
  }
  return { worktrees, deletedBranch }
}
