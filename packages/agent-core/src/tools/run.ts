import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isDir, isFile, resolveInRoot, shouldSkipDir, toRel } from './paths.js'
import type { ToolName } from './defs.js'
import {
  gitBranches,
  gitApplyStash,
  gitCommit,
  gitCreateBranch,
  gitCreateStash,
  gitCreateTag,
  gitDeleteBranch,
  gitDeleteTag,
  gitDiff,
  gitDropStash,
  gitConflicts,
  gitFetch,
  gitHistory,
  gitPull,
  gitPush,
  gitRemotes,
  gitResolveConflict,
  gitRenameBranch,
  gitStage,
  gitStageAll,
  gitStashes,
  gitStatus,
  gitSwitchBranch,
  gitTags,
  gitUnstage,
  gitUnstageAll,
} from '../git.js'
import { memoryDelete, memorySearch, memoryWrite } from '../context.js'
import { mcpCallTool, mcpListTools } from '../mcp.js'
import { webFetch, webSearch } from '../web.js'

const DEFAULT_READ = 120_000
const DEFAULT_GLOB = 200
const DEFAULT_GREP = 50
const MAX_WRITE = 500_000
const MAX_SHELL_OUT = 100_000
const DEFAULT_SHELL_TIMEOUT = 60_000
const MAX_SHELL_TIMEOUT = 300_000

/** Default deny globs for sensitive paths (workspace-relative, / normalized). */
export const DEFAULT_DENY_GLOBS = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '**/credentials.json',
  '**/secrets.json',
  '**/*secret*',
  '**/*credential*',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa',
  '**/id_ed25519',
]

export interface ToolResult {
  ok: boolean
  summary: string
  content: string
}

function ok(summary: string, content: string): ToolResult {
  return { ok: true, summary, content }
}

function fail(message: string): ToolResult {
  return { ok: false, summary: message, content: message }
}

/** Minimal glob match: * within segment, ** any depth. Case-sensitive. */
export function matchGlob(pattern: string, relPath: string): boolean {
  const pat = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  const target = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const base = path.basename(target)
  // Exact / basename hits for simple names (`.env`, `id_rsa`)
  if (pat === target || pat === base) return true
  // `foo` also matches `**/foo`
  if (!pat.includes('*') && !pat.includes('/') && base === pat) return true
  const re = globToRegExp(pat.startsWith('**/') || pat.includes('/') ? pat : `**/${pat}`)
  return re.test(target) || re.test(base)
}

export function isDeniedPath(relPath: string, extra: string[] = []): boolean {
  const rel = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!rel) return false
  for (const g of [...DEFAULT_DENY_GLOBS, ...extra]) {
    if (matchGlob(g, rel)) return true
  }
  // basename fallback for nested secrets even without ** in custom globs
  const base = path.basename(rel)
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.pem') || base.endsWith('.key')) return true
  if (/^(id_rsa|id_ed25519|credentials\.json|secrets\.json)$/i.test(base)) return true
  return false
}

export async function runTool(
  root: string,
  name: string,
  argsJson: string,
  options?: { denyGlobs?: string[]; homeDir?: string },
): Promise<ToolResult> {
  let args: Record<string, unknown> = {}
  try {
    args = argsJson?.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
  } catch {
    return fail(`invalid tool args JSON: ${argsJson.slice(0, 120)}`)
  }

  const denyGlobs = options?.denyGlobs ?? []
  const homeDir = options?.homeDir ?? os.homedir()

  // Block path tools on sensitive globs before any IO.
  const pathArg =
    typeof args.path === 'string'
      ? args.path
      : name === 'glob' && typeof args.pattern === 'string'
        ? undefined
        : undefined
  if (pathArg && isDeniedPath(pathArg, denyGlobs)) {
    return fail(`path denied by sensitive glob: ${pathArg}`)
  }

  try {
    switch (name as ToolName) {
      case 'plan_tasks': {
        const rawTasks = Array.isArray(args.tasks) ? args.tasks : []
        const tasks = rawTasks
          .map((task, index) => {
            const item = task as Record<string, unknown>
            return {
              id: `task-${index + 1}`,
              title: typeof item.title === 'string' ? item.title.trim().slice(0, 160) : '',
              detail: typeof item.detail === 'string' ? item.detail.trim().slice(0, 300) : undefined,
              status: index === 0 ? 'running' : 'pending',
            }
          })
          .filter((task) => task.title)
          .slice(0, 12)
        if (tasks.length < 2) return fail('plan_tasks requires at least 2 titled tasks')
        return ok('task plan published', JSON.stringify(tasks))
      }
      case 'list_dir':
        return listDir(root, String(args.path ?? '.'))
      case 'read_file':
        return readFile(
          root,
          String(args.path ?? ''),
          typeof args.maxBytes === 'number' ? args.maxBytes : DEFAULT_READ,
          denyGlobs,
        )
      case 'glob':
        return globFiles(
          root,
          String(args.pattern ?? ''),
          typeof args.maxResults === 'number' ? args.maxResults : DEFAULT_GLOB,
          denyGlobs,
        )
      case 'grep':
        return grepFiles(root, {
          pattern: String(args.pattern ?? ''),
          path: String(args.path ?? '.'),
          regex: Boolean(args.regex),
          maxResults: typeof args.maxResults === 'number' ? args.maxResults : DEFAULT_GREP,
          denyGlobs,
        })
      case 'search_codebase':
        return searchCodebase(root, {
          query: String(args.query ?? ''),
          path: String(args.path ?? '.'),
          maxResults: typeof args.maxResults === 'number' ? args.maxResults : 20,
          denyGlobs,
        })
      case 'write_file':
        return writeFileTool(root, String(args.path ?? ''), String(args.content ?? ''), denyGlobs)
      case 'edit_file':
        return editFileTool(
          root,
          String(args.path ?? ''),
          String(args.old_string ?? ''),
          String(args.new_string ?? ''),
          denyGlobs,
        )
      case 'replace_file':
        return replaceFileTool(
          root,
          String(args.path ?? ''),
          String(args.expected_content ?? ''),
          String(args.content ?? ''),
          denyGlobs,
        )
      case 'memory_write': {
        const scope = args.scope === 'global' ? 'global' : 'project'
        const result = memoryWrite(root, {
          name: String(args.name ?? ''),
          content: String(args.content ?? ''),
          scope,
          homeDir,
        })
        return result.ok
          ? ok(result.summary, result.content)
          : fail(result.summary)
      }
      case 'memory_search': {
        const result = memorySearch(root, {
          query: String(args.query ?? ''),
          regex: Boolean(args.regex),
          maxResults: typeof args.maxResults === 'number' ? args.maxResults : 20,
          homeDir,
        })
        return result.ok
          ? ok(result.summary, result.content)
          : fail(result.summary)
      }
      case 'memory_delete': {
        const scope = args.scope === 'global' ? 'global' : 'project'
        const result = memoryDelete(root, {
          name: String(args.name ?? ''),
          scope,
          homeDir,
        })
        return result.ok ? ok(result.summary, result.content) : fail(result.summary)
      }
      case 'web_fetch': {
        const r = await webFetch({
          url: String(args.url ?? ''),
          maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
        })
        return r.ok ? ok(r.summary, r.content) : fail(r.content)
      }
      case 'web_search': {
        const r = await webSearch({
          query: String(args.query ?? ''),
          maxResults: typeof args.maxResults === 'number' ? args.maxResults : undefined,
        })
        return r.ok ? ok(r.summary, r.content) : fail(r.content)
      }
      case 'mcp_list_tools': {
        const server = typeof args.server === 'string' && args.server.trim() ? args.server.trim() : undefined
        const tools = await mcpListTools(root, server)
        return ok(
          `mcp tools (${tools.length}${server ? ` @ ${server}` : ''})`,
          JSON.stringify(
            tools.map((t) => ({
              server: t.server,
              name: t.name,
              description: t.description,
            })),
            null,
            2,
          ),
        )
      }
      case 'mcp_call_tool': {
        const server = String(args.server ?? '').trim()
        const tool = String(args.tool ?? '').trim()
        if (!server || !tool) return fail('mcp_call_tool requires server and tool')
        const toolArgs =
          args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
            ? (args.arguments as Record<string, unknown>)
            : {}
        try {
          const content = await mcpCallTool(root, server, tool, toolArgs)
          return ok(`mcp ${server}/${tool}`, content.slice(0, 100_000))
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
      case 'git_status':
        return ok('git status', JSON.stringify(gitStatus(root), null, 2))
      case 'git_diff': {
        const file = typeof args.path === 'string' && args.path.trim() ? args.path : undefined
        return ok(`git diff${args.staged ? ' --staged' : ''}${file ? ` ${file}` : ''}`, gitDiff(root, file, args.staged === true))
      }
      case 'git_history':
        return ok('git history', JSON.stringify(gitHistory(root, typeof args.limit === 'number' ? args.limit : 20), null, 2))
      case 'git_branches':
        return ok('git branches', JSON.stringify(gitBranches(root), null, 2))
      case 'git_stashes':
        return ok('git stashes', JSON.stringify(gitStashes(root), null, 2))
      case 'git_remotes':
        return ok('git remotes', JSON.stringify(gitRemotes(root), null, 2))
      case 'git_tags':
        return ok('git tags', JSON.stringify(gitTags(root), null, 2))
      case 'git_conflicts':
        return ok('git conflicts', JSON.stringify(gitConflicts(root), null, 2))
      case 'git_stage': {
        if (args.all === true) gitStageAll(root)
        else gitStage(root, String(args.path ?? ''))
        return ok('git stage completed', JSON.stringify(gitStatus(root), null, 2))
      }
      case 'git_unstage': {
        if (args.all === true) gitUnstageAll(root)
        else gitUnstage(root, String(args.path ?? ''))
        return ok('git unstage completed', JSON.stringify(gitStatus(root), null, 2))
      }
      case 'git_commit': {
        const content = gitCommit(root, String(args.message ?? ''))
        return ok('git commit completed', `${content}\n${JSON.stringify(gitStatus(root), null, 2)}`)
      }
      case 'git_branch': {
        const action = String(args.action ?? '')
        const name = String(args.name ?? '')
        if (action === 'create') gitCreateBranch(root, name)
        else if (action === 'switch') gitSwitchBranch(root, name, args.remote === true)
        else if (action === 'rename') gitRenameBranch(root, name, String(args.newName ?? ''))
        else if (action === 'delete') gitDeleteBranch(root, name)
        else return fail('git_branch action must be create|switch|rename|delete')
        return ok(`git branch ${action} completed`, JSON.stringify({ branches: gitBranches(root), status: gitStatus(root) }, null, 2))
      }
      case 'git_stash': {
        const action = String(args.action ?? '')
        if (action === 'create') gitCreateStash(root, String(args.message ?? ''), args.includeUntracked === true)
        else if (action === 'apply' || action === 'pop') gitApplyStash(root, String(args.ref ?? ''), action === 'pop')
        else if (action === 'drop') gitDropStash(root, String(args.ref ?? ''))
        else return fail('git_stash action must be create|apply|pop|drop')
        return ok(`git stash ${action} completed`, JSON.stringify({ stashes: gitStashes(root), status: gitStatus(root) }, null, 2))
      }
      case 'git_fetch':
        gitFetch(root, typeof args.remote === 'string' ? args.remote : undefined)
        return ok('git fetch completed', JSON.stringify({ remotes: gitRemotes(root), branches: gitBranches(root), status: gitStatus(root) }, null, 2))
      case 'git_pull':
        gitPull(root, typeof args.remote === 'string' ? args.remote : undefined, typeof args.branch === 'string' ? args.branch : undefined)
        return ok('git pull completed', JSON.stringify({ status: gitStatus(root), history: gitHistory(root, 20) }, null, 2))
      case 'git_push':
        gitPush(root, typeof args.remote === 'string' ? args.remote : undefined, typeof args.branch === 'string' ? args.branch : undefined, args.setUpstream === true)
        return ok('git push completed', JSON.stringify(gitStatus(root), null, 2))
      case 'git_resolve_conflict': {
        const resolution = String(args.resolution ?? '')
        if (resolution !== 'ours' && resolution !== 'theirs' && resolution !== 'mark') return fail('resolution must be ours|theirs|mark')
        gitResolveConflict(root, String(args.path ?? ''), resolution)
        return ok('git conflict resolved', JSON.stringify(gitStatus(root), null, 2))
      }
      case 'git_tag': {
        const action = String(args.action ?? '')
        const name = String(args.name ?? '')
        if (action === 'create') gitCreateTag(root, name, typeof args.message === 'string' ? args.message : undefined, typeof args.target === 'string' ? args.target : undefined)
        else if (action === 'delete') gitDeleteTag(root, name)
        else return fail('git_tag action must be create|delete')
        return ok(`git tag ${action} completed`, JSON.stringify(gitTags(root), null, 2))
      }
      case 'run_shell':
        return runShellTool(
          root,
          String(args.command ?? ''),
          String(args.cwd ?? '.'),
          typeof args.timeoutMs === 'number' ? args.timeoutMs : DEFAULT_SHELL_TIMEOUT,
        )
      default:
        return fail(`unknown tool: ${name}`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

/** Line-based unified hunk (prefix/suffix context, no full LCS). */
export function unifiedLineDiff(oldText: string, newText: string, path: string): string {
  const a = oldText.split(/\r?\n/)
  const b = newText.split(/\r?\n/)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (
    j < a.length - i &&
    j < b.length - i &&
    a[a.length - 1 - j] === b[b.length - 1 - j]
  ) {
    j++
  }

  const ctx = 2
  const preStart = Math.max(0, i - ctx)
  const lines: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${preStart + 1},${Math.max(1, a.length - j - preStart)} +${preStart + 1},${Math.max(1, b.length - j - preStart)} @@`,
  ]
  for (let k = preStart; k < i; k++) lines.push(` ${a[k] ?? ''}`)
  for (let k = i; k < a.length - j; k++) lines.push(`-${a[k] ?? ''}`)
  for (let k = i; k < b.length - j; k++) lines.push(`+${b[k] ?? ''}`)
  for (let k = a.length - j; k < Math.min(a.length, a.length - j + ctx); k++) {
    lines.push(` ${a[k] ?? ''}`)
  }
  // cap size for UI
  const body = lines.join('\n')
  return body.length > 4000 ? `${body.slice(0, 4000)}\n…` : body
}

/** Human-readable preview for approval UI (does not write). */
export function previewWriteTool(
  root: string,
  name: string,
  argsJson: string,
): { summary: string; preview: string } {
  let args: Record<string, unknown> = {}
  try {
    args = argsJson?.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
  } catch {
    return { summary: name, preview: argsJson.slice(0, 400) }
  }
  if (name === 'write_file') {
    const rel = String(args.path ?? '')
    const content = String(args.content ?? '')
    let prev = ''
    let exists = false
    try {
      const abs = resolveInRoot(root, rel)
      if (isFile(abs)) {
        exists = true
        const st = fs.statSync(abs)
        if (st.size <= MAX_WRITE) {
          const buf = fs.readFileSync(abs)
          if (!buf.includes(0)) prev = buf.toString('utf8')
        }
      }
    } catch {
      /* ignore */
    }
    const preview = exists
      ? unifiedLineDiff(prev, content, rel || 'file')
      : unifiedLineDiff('', content, rel || 'file')
    return {
      summary: `write_file ${rel} (${content.length} chars, ${exists ? 'overwrite' : 'create'})`,
      preview,
    }
  }
  if (name === 'edit_file') {
    const rel = String(args.path ?? '')
    const oldS = String(args.old_string ?? '')
    const newS = String(args.new_string ?? '')
    return {
      summary: `edit_file ${rel}`,
      preview: unifiedLineDiff(oldS, newS, rel || 'file'),
    }
  }
  if (name === 'replace_file') {
    const rel = String(args.path ?? '')
    const expected = String(args.expected_content ?? '')
    const content = String(args.content ?? '')
    return {
      summary: `replace_file ${rel}`,
      preview: unifiedLineDiff(expected, content, rel || 'file'),
    }
  }
  if (name === 'memory_write') {
    const note = String(args.name ?? '')
    const scope = args.scope === 'global' ? 'global' : 'project'
    const content = String(args.content ?? '')
    return {
      summary: `memory_write ${scope}/${note}.md (${content.length} chars)`,
      preview: content.slice(0, 4000),
    }
  }
  if (name === 'memory_delete') {
    const note = String(args.name ?? '')
    const scope = args.scope === 'global' ? 'global' : 'project'
    return {
      summary: `memory_delete ${scope}/${note}.md`,
      preview: `Delete durable memory note: ${scope}/${note}.md`,
    }
  }
  if (name === 'run_shell') {
    const command = String(args.command ?? '')
    const cwd = String(args.cwd ?? '.')
    const timeoutMs =
      typeof args.timeoutMs === 'number' ? args.timeoutMs : DEFAULT_SHELL_TIMEOUT
    return {
      summary: `run_shell ${command.slice(0, 100)}${command.length > 100 ? '…' : ''}`,
      preview: `$ ${command}\ncwd: ${cwd || '.'}\ntimeout: ${timeoutMs}ms`,
    }
  }
  if (name === 'git_stage' || name === 'git_unstage') {
    const target = args.all === true ? 'all changes' : String(args.path ?? '')
    return { summary: `${name} ${target}`, preview: `${name === 'git_stage' ? 'Stage' : 'Unstage'}: ${target}` }
  }
  if (name === 'git_commit') {
    const message = String(args.message ?? '')
    return { summary: `git_commit ${message.slice(0, 80)}`, preview: `Commit message:\n${message}` }
  }
  if (name === 'git_branch') {
    const action = String(args.action ?? '')
    const nameValue = String(args.name ?? '')
    const target = action === 'rename' ? `${nameValue} → ${String(args.newName ?? '')}` : nameValue
    return { summary: `git_branch ${action} ${target}`, preview: `Branch ${action}: ${target}` }
  }
  if (name === 'git_stash') {
    const action = String(args.action ?? '')
    const target = action === 'create' ? String(args.message ?? 'enpii stash') : String(args.ref ?? '')
    return { summary: `git_stash ${action} ${target}`, preview: `Stash ${action}: ${target}` }
  }
  if (name === 'git_fetch' || name === 'git_pull' || name === 'git_push') {
    const remote = String(args.remote ?? 'configured upstream')
    const branch = args.branch ? ` ${String(args.branch)}` : ''
    return { summary: `${name} ${remote}${branch}`, preview: `${name.replace('_', ' ')}: ${remote}${branch}` }
  }
  if (name === 'git_resolve_conflict') {
    return { summary: `git_resolve_conflict ${String(args.path ?? '')}`, preview: `Resolution ${String(args.resolution ?? '')}: ${String(args.path ?? '')}` }
  }
  if (name === 'git_tag') {
    const action = String(args.action ?? '')
    const nameValue = String(args.name ?? '')
    return { summary: `git_tag ${action} ${nameValue}`, preview: `${action === 'delete' ? 'Delete' : 'Create'} tag: ${nameValue}` }
  }
  return { summary: name, preview: argsJson.slice(0, 400) }
}

function shellBlocked(command: string): string | null {
  const c = command.trim()
  if (!c) return 'command required'
  // v0 hard blocks — high-risk destructive git
  if (/\bgit\s+push\b[^\n]*--force\b/i.test(c)) return 'blocked: git push --force'
  if (/\bgit\s+reset\s+--hard\b/i.test(c)) return 'blocked: git reset --hard'
  if (/\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d[a-zA-Z]*x\b/i.test(c)) {
    return 'blocked: git clean -fdx'
  }
  return null
}

function runShellTool(
  root: string,
  command: string,
  cwdRel: string,
  timeoutMs: number,
): Promise<ToolResult> {
  const blocked = shellBlocked(command)
  if (blocked) return Promise.resolve(fail(blocked))

  let cwd: string
  try {
    cwd = resolveInRoot(root, cwdRel || '.')
  } catch (err) {
    return Promise.resolve(fail(err instanceof Error ? err.message : String(err)))
  }
  if (!isDir(cwd)) {
    return Promise.resolve(fail(`cwd not a directory: ${cwdRel || '.'}`))
  }

  const timeout = Math.min(
    Math.max(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_SHELL_TIMEOUT, 1_000),
    MAX_SHELL_TIMEOUT,
  )
  const started = Date.now()
  const relCwd = toRel(root, cwd) || '.'

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false

    const finish = (r: ToolResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    const take = (chunk: string, which: 'out' | 'err') => {
      if (which === 'out') {
        if (stdout.length >= MAX_SHELL_OUT) {
          truncated = true
          return
        }
        const room = MAX_SHELL_OUT - stdout.length
        stdout += chunk.slice(0, room)
        if (chunk.length > room) truncated = true
      } else {
        if (stderr.length >= MAX_SHELL_OUT) {
          truncated = true
          return
        }
        const room = MAX_SHELL_OUT - stderr.length
        stderr += chunk.slice(0, room)
        if (chunk.length > room) truncated = true
      }
    }

    child.stdout?.on('data', (buf: Buffer) => take(buf.toString('utf8'), 'out'))
    child.stderr?.on('data', (buf: Buffer) => take(buf.toString('utf8'), 'err'))

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 1500)
      const ms = Date.now() - started
      finish(
        fail(
          `timeout after ${timeout}ms (ran ${ms}ms)\ncwd: ${relCwd}\n$ ${command}\n${stdout || stderr ? `partial:\n${stdout}${stderr ? `\n--- stderr ---\n${stderr}` : ''}` : ''}`,
        ),
      )
    }, timeout)

    child.on('error', (err) => {
      finish(fail(`spawn failed: ${err.message}`))
    })

    child.on('close', (code, signal) => {
      if (settled) return
      const ms = Date.now() - started
      const exit = signal ? `signal ${signal}` : `exit ${code ?? '?'}`
      const parts: string[] = [`${exit} · ${ms}ms`, `cwd: ${relCwd}`, `$ ${command}`, '']
      if (stdout) parts.push(stdout)
      if (stderr) parts.push(`--- stderr ---\n${stderr}`)
      if (!stdout && !stderr) parts.push('(no output)')
      if (truncated) parts.push('\n… truncated')
      const content = parts.join('\n')
      const summary = `run_shell ${command.slice(0, 60)}${command.length > 60 ? '…' : ''} (${exit}, ${ms}ms)`
      finish({
        ok: code === 0 && !signal,
        summary,
        content: content.slice(0, MAX_SHELL_OUT + 500),
      })
    })
  })
}

function writeFileTool(root: string, rel: string, content: string, denyGlobs: string[] = []): ToolResult {
  if (!rel) return fail('path required')
  if (isDeniedPath(rel, denyGlobs)) return fail(`path denied by sensitive glob: ${rel}`)
  if (content.length > MAX_WRITE) return fail(`content too large (>${MAX_WRITE} chars)`)
  const abs = resolveInRoot(root, rel)
  const dir = path.dirname(abs)
  fs.mkdirSync(dir, { recursive: true })
  const existed = isFile(abs)
  fs.writeFileSync(abs, content, 'utf8')
  const action = existed ? 'overwrote' : 'created'
  return ok(`write_file ${rel} (${action}, ${content.length} chars)`, `${action} ${rel}`)
}

function editFileTool(
  root: string,
  rel: string,
  oldString: string,
  newString: string,
  denyGlobs: string[] = [],
): ToolResult {
  if (!rel) return fail('path required')
  if (isDeniedPath(rel, denyGlobs)) return fail(`path denied by sensitive glob: ${rel}`)
  if (!oldString) return fail('old_string required')
  const abs = resolveInRoot(root, rel)
  if (!isFile(abs)) return fail(`not a file: ${rel}`)
  const text = fs.readFileSync(abs, 'utf8')
  if (text.includes('\0')) return fail(`binary file refused: ${rel}`)

  // Match ignoring CRLF vs LF (Windows files + model often disagree).
  const crlf = text.includes('\r\n')
  const norm = (s: string) => s.replace(/\r\n/g, '\n')
  const textN = norm(text)
  const oldN = norm(oldString)
  const newN = norm(newString)

  const count = textN.split(oldN).length - 1
  if (count === 0) return fail(`old_string not found in ${rel}`)
  if (count > 1) return fail(`old_string matches ${count} times in ${rel} — must be unique`)

  let next = textN.replace(oldN, newN)
  if (crlf) next = next.replace(/\n/g, '\r\n')
  if (next.length > MAX_WRITE) return fail(`result too large (>${MAX_WRITE} chars)`)
  fs.writeFileSync(abs, next, 'utf8')
  return ok(
    `edit_file ${rel} (${oldString.length}→${newString.length} chars)`,
    `edited ${rel}`,
  )
}

function listDir(root: string, rel: string): ToolResult {
  const abs = resolveInRoot(root, rel || '.')
  if (!isDir(abs)) return fail(`not a directory: ${rel}`)
  const entries = fs.readdirSync(abs, { withFileTypes: true })
  const lines = entries
    .filter((e) => !shouldSkipDir(e.name))
    .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
    .sort()
  return ok(`list_dir ${rel || '.'} (${lines.length})`, lines.join('\n') || '(empty)')
}

function readFile(root: string, rel: string, maxBytes: number, denyGlobs: string[] = []): ToolResult {
  if (!rel) return fail('path required')
  if (isDeniedPath(rel, denyGlobs)) return fail(`path denied by sensitive glob: ${rel}`)
  const abs = resolveInRoot(root, rel)
  if (!isFile(abs)) return fail(`not a file: ${rel}`)
  const stat = fs.statSync(abs)
  const buf = Buffer.alloc(Math.min(stat.size, maxBytes + 1))
  const fd = fs.openSync(abs, 'r')
  try {
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const slice = buf.subarray(0, Math.min(n, maxBytes))
    if (slice.includes(0)) return fail(`binary file refused: ${rel}`)
    const text = slice.toString('utf8')
    const truncated = n > maxBytes || stat.size > maxBytes
    const body = truncated
      ? `${text}\n\n… truncated (${stat.size} bytes, showed ${maxBytes})`
      : text
    return ok(`read_file ${rel} (${stat.size}b)`, body)
  } finally {
    fs.closeSync(fd)
  }
}

function replaceFileTool(
  root: string,
  rel: string,
  expected: string,
  content: string,
  denyGlobs: string[] = [],
): ToolResult {
  if (!rel) return fail('path required')
  if (isDeniedPath(rel, denyGlobs)) return fail(`path denied by sensitive glob: ${rel}`)
  if (expected.length > MAX_WRITE || content.length > MAX_WRITE) return fail(`content too large (max ${MAX_WRITE})`)
  const abs = resolveInRoot(root, rel)
  if (!isFile(abs)) return fail(`edit conflict: file missing: ${rel}`)
  const current = fs.readFileSync(abs)
  if (current.includes(0)) return fail(`binary file refused: ${rel}`)
  const currentText = current.toString('utf8')
  const normalize = (value: string) => value.replace(/\r\n/g, '\n')
  if (normalize(currentText) !== normalize(expected)) {
    return fail(`edit conflict: file changed since opened: ${rel}`)
  }
  const next = currentText.includes('\r\n')
    ? normalize(content).replace(/\n/g, '\r\n')
    : normalize(content)
  const temp = `${abs}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temp, next, 'utf8')
    fs.renameSync(temp, abs)
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true })
  }
  return ok(`replace_file ${rel} (${next.length} chars)`, `replaced ${rel}`)
}

function globToRegExp(pattern: string): RegExp {
  // very small glob: ** * ?
  let i = 0
  let out = '^'
  const p = pattern.replace(/\\/g, '/')
  while (i < p.length) {
    const c = p[i]
    if (c === '*' && p[i + 1] === '*') {
      out += '.*'
      i += 2
      if (p[i] === '/') i++
      continue
    }
    if (c === '*') {
      out += '[^/]*'
      i++
      continue
    }
    if (c === '?') {
      out += '[^/]'
      i++
      continue
    }
    if ('+^$()[]{}|.'.includes(c)) out += `\\${c}`
    else out += c
    i++
  }
  out += '$'
  return new RegExp(out)
}

function walkFiles(root: string, dir: string, out: string[], max: number): void {
  if (out.length >= max) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= max) return
    if (e.name.startsWith('.') && e.name !== '.env.example') {
      if (e.name === '.git' || e.name === '.enpii') continue
    }
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name)) continue
      walkFiles(root, path.join(dir, e.name), out, max)
    } else if (e.isFile()) {
      out.push(path.join(dir, e.name))
    }
  }
}

function globFiles(
  root: string,
  pattern: string,
  maxResults: number,
  denyGlobs: string[] = [],
): ToolResult {
  if (!pattern) return fail('pattern required')
  const re = globToRegExp(pattern.startsWith('**/') ? pattern : `**/${pattern}`)
  const rootAbs = path.resolve(root)
  const files: string[] = []
  walkFiles(rootAbs, rootAbs, files, 50_000)
  const hits: string[] = []
  for (const f of files) {
    const rel = toRel(rootAbs, f)
    if (isDeniedPath(rel, denyGlobs)) continue
    if (re.test(rel) || re.test(rel.split('/').pop() ?? '')) {
      hits.push(rel)
      if (hits.length >= maxResults) break
    }
  }
  return ok(`glob ${pattern} (${hits.length})`, hits.join('\n') || '(no matches)')
}

function searchCodebase(
  root: string,
  opts: {
    query: string
    path: string
    maxResults: number
    denyGlobs?: string[]
  },
): ToolResult {
  const query = opts.query.trim()
  if (!query) return fail('query required')
  if (opts.path && isDeniedPath(opts.path, opts.denyGlobs ?? [])) {
    return fail(`path denied by sensitive glob: ${opts.path}`)
  }
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 8)
  if (!terms.length) return fail('query needs at least one term (≥2 chars)')

  const maxResults = Math.min(Math.max(1, Math.floor(opts.maxResults) || 20), 50)
  const maxWalk = 8_000
  const maxBodyReads = 2_500
  const start = resolveInRoot(root, opts.path || '.')
  const rootAbs = path.resolve(root)
  const files: string[] = []
  if (isFile(start)) files.push(start)
  else walkFiles(rootAbs, start, files, maxWalk)

  type Hit = { score: number; path: string; why: string; pathOnly: boolean }
  const hits: Hit[] = []
  // Pass 1: path/name scores only (cheap)
  for (const f of files) {
    const rel = toRel(rootAbs, f)
    if (isDeniedPath(rel, opts.denyGlobs ?? [])) continue
    const base = path.basename(rel).toLowerCase()
    const relLower = rel.toLowerCase()
    let score = 0
    const why: string[] = []
    for (const term of terms) {
      if (base === term || base.startsWith(`${term}.`)) {
        score += 12
        why.push(`name=${term}`)
      } else if (base.includes(term)) {
        score += 8
        why.push(`name~${term}`)
      } else if (relLower.includes(term)) {
        score += 4
        why.push(`path~${term}`)
      }
    }
    if (score > 0) hits.push({ score, path: rel, why: why.join(',') || 'path', pathOnly: true })
  }

  // Strong name hits: skip body scan (large monorepo fast path).
  const strong = hits.filter((h) => h.score >= 8).sort((a, b) => b.score - a.score)
  const skipBody = strong.length >= Math.min(maxResults, 12)

  if (!skipBody) {
    let bodyReads = 0
    const pathHit = new Map(hits.map((h) => [h.path, h]))
    for (const f of files) {
      if (bodyReads >= maxBodyReads) break
      const rel = toRel(rootAbs, f)
      if (isDeniedPath(rel, opts.denyGlobs ?? [])) continue
      let text = ''
      try {
        const st = fs.statSync(f)
        if (st.size > 200_000) continue
        const buf = fs.readFileSync(f)
        bodyReads++
        if (buf.includes(0)) continue
        text = buf.toString('utf8')
      } catch {
        continue
      }
      const lower = text.toLowerCase()
      let contentHits = 0
      const sampleLines: string[] = []
      let score = pathHit.get(rel)?.score ?? 0
      const why = pathHit.get(rel)?.why ? [pathHit.get(rel)!.why] : []
      for (const term of terms) {
        if (!lower.includes(term)) continue
        contentHits++
        score += 3
        if (sampleLines.length < 2) {
          const idx = lower.indexOf(term)
          const lineStart = lower.lastIndexOf('\n', idx) + 1
          const lineEnd = lower.indexOf('\n', idx)
          const line = text.slice(lineStart, lineEnd === -1 ? idx + 80 : lineEnd).trim().slice(0, 120)
          if (line) sampleLines.push(line)
        }
      }
      if (contentHits) why.push(`body×${contentHits}`)
      if (score <= 0) continue
      const next = {
        score,
        path: rel,
        why: [...why, ...sampleLines.map((l) => `› ${l}`)].join(' | '),
        pathOnly: false,
      }
      const prev = pathHit.get(rel)
      if (prev) Object.assign(prev, next)
      else {
        hits.push(next)
        pathHit.set(rel, next)
      }
    }
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const top = hits.slice(0, maxResults)
  const note = skipBody ? ' (path-fast)' : ''
  const body = top.map((h, i) => `${i + 1}. [${h.score}] ${h.path}\n   ${h.why}`).join('\n')
  return ok(
    `search_codebase ${JSON.stringify(query)} (${top.length}/${hits.length})${note}`,
    body || '(no matches)',
  )
}

function grepFiles(
  root: string,
  opts: {
    pattern: string
    path: string
    regex: boolean
    maxResults: number
    denyGlobs?: string[]
  },
): ToolResult {
  if (!opts.pattern) return fail('pattern required')
  if (opts.path && isDeniedPath(opts.path, opts.denyGlobs ?? [])) {
    return fail(`path denied by sensitive glob: ${opts.path}`)
  }
  let re: RegExp
  try {
    re = opts.regex
      ? new RegExp(opts.pattern, 'i')
      : new RegExp(opts.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  } catch (err) {
    return fail(`bad regex: ${err instanceof Error ? err.message : String(err)}`)
  }

  const start = resolveInRoot(root, opts.path || '.')
  const rootAbs = path.resolve(root)
  const files: string[] = []
  if (isFile(start)) files.push(start)
  else walkFiles(rootAbs, start, files, 20_000)

  const lines: string[] = []
  for (const f of files) {
    if (lines.length >= opts.maxResults) break
    const rel = toRel(rootAbs, f)
    if (isDeniedPath(rel, opts.denyGlobs ?? [])) continue
    let text: string
    try {
      const st = fs.statSync(f)
      if (st.size > 1_000_000) continue
      const buf = fs.readFileSync(f)
      if (buf.includes(0)) continue
      text = buf.toString('utf8')
    } catch {
      continue
    }
    const split = text.split(/\r?\n/)
    for (let i = 0; i < split.length; i++) {
      if (lines.length >= opts.maxResults) break
      if (re.test(split[i]!)) {
        lines.push(`${rel}:${i + 1}:${split[i]!.slice(0, 240)}`)
      }
    }
  }
  return ok(`grep ${opts.pattern} (${lines.length})`, lines.join('\n') || '(no matches)')
}
