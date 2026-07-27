import { StdioJsonRpcServer } from './rpc.js'
import { SessionStore } from './session.js'
import {
  loadProviderConfig,
  assertProviderReady,
  publicConfig,
  saveProviderConfig,
  type ProviderConfig,
  type ProviderConfigPatch,
} from './config.js'
import {
  resolveAllApprovals,
  resolveApproval,
  resolveAnswer,
  compactRuntime,
  runDirectEdit,
  runPromptTurn,
  stopTurn,
  undoCompactRuntime,
  type SessionRuntime,
} from './loop.js'
import type { HealthResult } from './types.js'
import type { ChatMessage } from './provider/openai.js'
import { runTool } from './tools/run.js'
import { resolveInRoot } from './tools/paths.js'
import { gitApplyStash, gitBranches, gitCommit, gitCommitDiff, gitCommitFiles, gitCommitSuggestion, gitConflict, gitConflicts, gitCreateBranch, gitCreateStash, gitCreateTag, gitDeleteBranch, gitDeleteTag, gitDiff, gitDiscard, gitDropStash, gitFetch, gitHistory, gitPull, gitPush, gitPushTag, gitRelease, gitRemotes, gitRenameBranch, gitResolveConflict, gitStage, gitStageAll, gitStashAndSwitch, gitStashes, gitStatus, gitSwitchBranch, gitTags, gitUnstage, gitUnstageAll, gitWorktreeAdd, gitWorktreeApply, gitWorktreeDiscard, gitWorktreeList, gitWorktreePreview, gitWorktreeRemove } from './git.js'
import fs from 'node:fs'
import path from 'node:path'
import { checkpointAccept, checkpointClearAll, checkpointList, checkpointRollback } from './checkpoint.js'
import { projectDiagnostics } from './diagnostics.js'
import { formatProjectFile } from './formatter.js'
import {
  ensureMcpConfigScaffold,
  loadMcpConfig,
  mcpCallTool,
  mcpDisconnectAll,
  mcpGetPrompt,
  mcpListPrompts,
  mcpListResources,
  mcpListServers,
  mcpListTools,
  mcpReadResource,
} from './mcp.js'
import {
  cronCreate,
  cronDelete,
  cronList,
  cronMarkRan,
  cronToggle,
  startCronScheduler,
  stopCronScheduler,
  type DueCronJob,
} from './cron.js'
import {
  ensureSshConfigScaffold,
  listLiveTunnels,
  listSshHosts,
  listSshTunnels,
  sshArgv,
  startTunnel,
  stopAllTunnels,
  stopTunnel,
  tunnelArgv,
} from './ssh.js'

const VERSION = '0.1.0'

function shortToolSummary(name: string, args: string): string {
  try {
    const o = JSON.parse(args || '{}') as Record<string, unknown>
    const bits = Object.entries(o)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ')
    return `${name}${bits ? ` ${bits}` : ''}`.slice(0, 120)
  } catch {
    return `${name} ${args}`.slice(0, 120)
  }
}

/** UI timeline rows — one card per tool *result* (not tool_call + result). */
function toolResultOk(content: string): boolean {
  const c = content.toLowerCase()
  if (c.startsWith('user denied')) return false
  if (c.includes('write blocked') || c.includes('shell blocked')) return false
  if (c.startsWith('invalid tool')) return false
  if (c.startsWith('unknown tool')) return false
  if (c.startsWith('not a file') || c.startsWith('not a directory')) return false
  if (c.startsWith('path outside')) return false
  if (c.startsWith('old_string ')) return false
  if (c.startsWith('path required') || c.startsWith('pattern required') || c.startsWith('command required')) return false
  if (c.startsWith('content too large') || c.startsWith('result too large')) return false
  if (c.startsWith('binary file')) return false
  if (c.startsWith('bad regex')) return false
  if (c.startsWith('blocked:')) return false
  if (c.startsWith('timeout after')) return false
  if (c.startsWith('spawn failed')) return false
  if (c.startsWith('cwd not a directory')) return false
  if (c.includes('exit ') && !c.includes('exit 0')) {
    // tool content starts with "exit N · …" for non-zero
    if (/^exit [1-9]/.test(c) || /^exit -\d/.test(c)) return false
  }
  return true
}

function uiMessagesFromRuntime(messages: ChatMessage[]): {
  role: string
  content: string
  toolName?: string
  summary?: string
  preview?: string
  ok?: boolean
}[] {
  const out: {
    role: string
    content: string
    toolName?: string
    summary?: string
    preview?: string
    ok?: boolean
  }[] = []

  // index tool_calls by id for summary labels
  const callMeta = new Map<string, { name: string; args: string }>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        callMeta.set(tc.id, {
          name: tc.function.name,
          args: tc.function.arguments || '{}',
        })
      }
    }
  }

  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      const content = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
          : ''
      if (content) out.push({ role: 'user', content })
      continue
    }
    if (m.role === 'assistant') {
      const content = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
          : ''
      if (content) out.push({ role: 'assistant', content })
      // tool_calls themselves are not UI rows — wait for tool results
      continue
    }
    if (m.role === 'tool') {
      const meta = m.tool_call_id ? callMeta.get(m.tool_call_id) : undefined
      const name = m.name || meta?.name || 'tool'
      const summary = meta
        ? shortToolSummary(meta.name, meta.args)
        : name
      const preview =
        typeof m.content === 'string' ? m.content.slice(0, 500) : ''
      const ok = toolResultOk(typeof m.content === 'string' ? m.content : '')
      out.push({
        role: 'tool',
        content: summary,
        toolName: name,
        summary,
        preview,
        ok,
      })
    }
  }
  return out
}

async function main(): Promise<void> {
  checkpointClearAll()
  const sessions = new SessionStore()
  const runtimes = new Map<string, SessionRuntime>()
  const rpc = new StdioJsonRpcServer()
  let provider: ProviderConfig = loadProviderConfig()

  function getRuntime(sessionId: string): SessionRuntime | undefined {
    const meta = sessions.get(sessionId)
    if (!meta) return undefined
    const messages = sessions.getMessages(sessionId)
    const existing = runtimes.get(sessionId)
    if (existing) {
      existing.meta = meta
      // Prefer longer transcript (disk may be newer after restart)
      if (messages.length >= existing.messages.length) {
        existing.messages = messages
      }
      return existing
    }
    const runtime: SessionRuntime = { meta, messages }
    runtimes.set(sessionId, runtime)
    return runtime
  }

  rpc.on('health', (): HealthResult => ({
    ok: true,
    name: 'enpii',
    version: VERSION,
    contractVersion: '0.1.0',
    pid: process.pid,
  }))

  rpc.on('config.get', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (p.projectRoot) provider = loadProviderConfig(path.resolve(p.projectRoot))
    return publicConfig(provider)
  })

  rpc.on('config.set', (_method, params) => {
    const p = (params ?? {}) as ProviderConfigPatch & {
      projectRoot?: string
      scope?: 'user' | 'project'
    }
    const { projectRoot, scope, ...patch } = p
    provider = saveProviderConfig(provider, patch, {
      projectRoot: projectRoot ? path.resolve(projectRoot) : undefined,
      scope,
    })
    // Reload with project overlay when provided
    if (projectRoot) provider = loadProviderConfig(path.resolve(projectRoot))
    console.error(
      `[enpii] config updated model=${provider.model} base=${provider.baseUrl} key=${provider.apiKey ? 'yes' : 'no'} mode=${provider.permissionMode}`,
    )
    return publicConfig(provider)
  })

  rpc.on('mcp.list_servers', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    ensureMcpConfigScaffold()
    const root = p.projectRoot ? path.resolve(p.projectRoot) : undefined
    const servers = loadMcpConfig(root)
    return {
      servers: Object.entries(servers).map(([name, cfg]) => {
        if ('url' in cfg && typeof cfg.url === 'string') {
          return {
            name,
            transport: 'http' as const,
            url: cfg.url,
            headerKeys: cfg.headers ? Object.keys(cfg.headers) : [],
          }
        }
        return {
          name,
          transport: 'stdio' as const,
          command: cfg.command,
          args: cfg.args ?? [],
        }
      }),
    }
  })

  rpc.on('mcp.list_tools', async (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; server?: string }
    const root = p.projectRoot ? path.resolve(p.projectRoot) : undefined
    const tools = await mcpListTools(root, p.server)
    return { tools }
  })

  rpc.on('mcp.call_tool', async (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      server?: string
      tool?: string
      arguments?: Record<string, unknown>
    }
    if (!p.server?.trim() || !p.tool?.trim()) throw new Error('server and tool are required')
    const content = await mcpCallTool(
      p.projectRoot ? path.resolve(p.projectRoot) : undefined,
      p.server.trim(),
      p.tool.trim(),
      p.arguments && typeof p.arguments === 'object' ? p.arguments : {},
    )
    return { content }
  })

  rpc.on('mcp.list_resources', async (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; server?: string }
    const root = p.projectRoot ? path.resolve(p.projectRoot) : undefined
    const resources = await mcpListResources(root, p.server)
    return { resources }
  })

  rpc.on('mcp.read_resource', async (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; server?: string; uri?: string }
    if (!p.server?.trim() || !p.uri?.trim()) throw new Error('server and uri are required')
    const content = await mcpReadResource(
      p.projectRoot ? path.resolve(p.projectRoot) : undefined,
      p.server.trim(),
      p.uri.trim(),
    )
    return { content }
  })

  rpc.on('mcp.list_prompts', async (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; server?: string }
    const root = p.projectRoot ? path.resolve(p.projectRoot) : undefined
    const prompts = await mcpListPrompts(root, p.server)
    return { prompts }
  })

  rpc.on('mcp.get_prompt', async (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      server?: string
      name?: string
      arguments?: Record<string, unknown>
    }
    if (!p.server?.trim() || !p.name?.trim()) throw new Error('server and name are required')
    const args: Record<string, string> = {}
    if (p.arguments && typeof p.arguments === 'object') {
      for (const [k, v] of Object.entries(p.arguments)) {
        if (v == null) continue
        args[k] = String(v)
      }
    }
    const content = await mcpGetPrompt(
      p.projectRoot ? path.resolve(p.projectRoot) : undefined,
      p.server.trim(),
      p.name.trim(),
      args,
    )
    return { content }
  })

  rpc.on('ssh.list', () => {
    ensureSshConfigScaffold()
    return { hosts: listSshHosts(), tunnels: listSshTunnels(), live: listLiveTunnels() }
  })

  rpc.on('ssh.plan', (_method, params) => {
    const p = (params ?? {}) as { host?: string; tunnel?: string }
    if (p.tunnel?.trim()) return tunnelArgv(p.tunnel.trim())
    if (p.host?.trim()) return sshArgv(p.host.trim())
    throw new Error('host or tunnel is required')
  })

  rpc.on('ssh.tunnel_start', (_method, params) => {
    const p = (params ?? {}) as { name?: string }
    if (!p.name?.trim()) throw new Error('name is required')
    return startTunnel(p.name.trim())
  })

  rpc.on('ssh.tunnel_stop', (_method, params) => {
    const p = (params ?? {}) as { name?: string }
    if (!p.name?.trim()) throw new Error('name is required')
    return stopTunnel(p.name.trim())
  })

  rpc.on('ssh.tunnel_stop_all', () => stopAllTunnels())

  rpc.on('project.list_dir', async (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const result = await runTool(path.resolve(p.projectRoot), 'list_dir', JSON.stringify({ path: p.path ?? '.' }))
    if (!result.ok) throw new Error(result.content)
    return result
  })

  rpc.on('project.read_file', async (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string; maxBytes?: number }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const result = await runTool(
      path.resolve(p.projectRoot),
      'read_file',
      JSON.stringify({ path: p.path, maxBytes: p.maxBytes ?? 120_000 }),
      { denyGlobs: provider.denyGlobs ?? [] },
    )
    if (!result.ok) throw new Error(result.content)
    return result
  })

  rpc.on('project.search_files', async (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; query?: string; maxResults?: number }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const query = p.query?.trim()
    if (!query) return { content: '' }
    const result = await runTool(
      path.resolve(p.projectRoot),
      'glob',
      JSON.stringify({
        pattern: `*${query.replace(/[?*]/g, '')}*`,
        maxResults: Math.min(Math.max(p.maxResults ?? 100, 1), 200),
      }),
      { denyGlobs: provider.denyGlobs ?? [] },
    )
    if (!result.ok) throw new Error(result.content)
    return result
  })

  rpc.on('project.create_entry', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; dir?: string; name?: string; kind?: 'file' | 'directory' }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const name = p.name?.trim() ?? ''
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('invalid entry name')
    if (p.kind !== 'file' && p.kind !== 'directory') throw new Error('kind must be file|directory')
    const root = path.resolve(p.projectRoot)
    const parent = resolveInRoot(root, p.dir ?? '.')
    if (!fs.statSync(parent).isDirectory()) throw new Error('parent is not a directory')
    const target = resolveInRoot(root, path.join(p.dir ?? '.', name))
    if (fs.existsSync(target)) throw new Error(`already exists: ${name}`)
    if (p.kind === 'directory') fs.mkdirSync(target)
    else fs.writeFileSync(target, '', { encoding: 'utf8', flag: 'wx' })
    return { path: path.relative(root, target).split(path.sep).join('/'), kind: p.kind }
  })

  rpc.on('project.diagnostics', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return projectDiagnostics(p.projectRoot, p.path)
  })

  rpc.on('project.format_file', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string; content?: string }
    if (!p.projectRoot || !p.path || typeof p.content !== 'string') throw new Error('projectRoot, path, and content are required')
    return formatProjectFile(p.projectRoot, p.path, p.content)
  })

  rpc.on('checkpoint.list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; limit?: number }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return checkpointList(p.projectRoot, p.limit)
  })

  rpc.on('checkpoint.rollback', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; checkpointId?: string; path?: string }
    if (!p.projectRoot || !p.checkpointId) throw new Error('projectRoot and checkpointId are required')
    checkpointRollback(p.projectRoot, p.checkpointId, p.path)
    return checkpointList(p.projectRoot)
  })

  rpc.on('checkpoint.accept', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; checkpointId?: string; path?: string }
    if (!p.projectRoot || !p.checkpointId) throw new Error('projectRoot and checkpointId are required')
    return checkpointAccept(p.projectRoot, p.checkpointId, p.path)
  })

  rpc.on('git.status', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.diff', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string; staged?: boolean }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    if (!p.path) throw new Error('path is required')
    return { content: gitDiff(p.projectRoot, p.path, p.staged === true) }
  })

  rpc.on('git.history', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; limit?: number }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitHistory(p.projectRoot, p.limit)
  })

  rpc.on('git.commit_diff', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; hash?: string; path?: string }
    if (!p.projectRoot || !p.hash) throw new Error('projectRoot and hash are required')
    return { content: gitCommitDiff(p.projectRoot, p.hash, p.path) }
  })

  rpc.on('git.commit_files', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; hash?: string }
    if (!p.projectRoot || !p.hash) throw new Error('projectRoot and hash are required')
    return gitCommitFiles(p.projectRoot, p.hash)
  })

  rpc.on('git.branch_list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitBranches(p.projectRoot)
  })

  rpc.on('git.branch_create', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; name?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    gitCreateBranch(p.projectRoot, p.name ?? '')
    return { branches: gitBranches(p.projectRoot), status: gitStatus(p.projectRoot) }
  })

  rpc.on('git.branch_switch', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; name?: string; remote?: boolean }
    if (!p.projectRoot || !p.name) throw new Error('projectRoot and name are required')
    gitSwitchBranch(p.projectRoot, p.name, p.remote === true)
    return { branches: gitBranches(p.projectRoot), status: gitStatus(p.projectRoot) }
  })

  rpc.on('git.branch_switch_stash', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; name?: string; remote?: boolean }
    if (!p.projectRoot || !p.name) throw new Error('projectRoot and name are required')
    gitStashAndSwitch(p.projectRoot, p.name, p.remote === true)
    return { branches: gitBranches(p.projectRoot), status: gitStatus(p.projectRoot), stashes: gitStashes(p.projectRoot) }
  })

  rpc.on('git.branch_rename', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; oldName?: string; newName?: string }
    if (!p.projectRoot || !p.oldName) throw new Error('projectRoot and oldName are required')
    gitRenameBranch(p.projectRoot, p.oldName, p.newName ?? '')
    return { branches: gitBranches(p.projectRoot), status: gitStatus(p.projectRoot) }
  })

  rpc.on('git.branch_delete', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; name?: string }
    if (!p.projectRoot || !p.name) throw new Error('projectRoot and name are required')
    gitDeleteBranch(p.projectRoot, p.name)
    return gitBranches(p.projectRoot)
  })

  rpc.on('git.stash_list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitStashes(p.projectRoot)
  })

  rpc.on('git.stash_create', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; message?: string; includeUntracked?: boolean }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    gitCreateStash(p.projectRoot, p.message ?? '', p.includeUntracked === true)
    return { stashes: gitStashes(p.projectRoot), status: gitStatus(p.projectRoot) }
  })

  rpc.on('git.stash_apply', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; ref?: string; pop?: boolean }
    if (!p.projectRoot || !p.ref) throw new Error('projectRoot and ref are required')
    gitApplyStash(p.projectRoot, p.ref, p.pop === true)
    return { stashes: gitStashes(p.projectRoot), status: gitStatus(p.projectRoot) }
  })

  rpc.on('git.stash_drop', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; ref?: string }
    if (!p.projectRoot || !p.ref) throw new Error('projectRoot and ref are required')
    gitDropStash(p.projectRoot, p.ref)
    return gitStashes(p.projectRoot)
  })

  rpc.on('git.remote_list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitRemotes(p.projectRoot)
  })

  rpc.on('git.tag_list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitTags(p.projectRoot)
  })

  rpc.on('git.tag_create', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; name?: string; message?: string; target?: string }
    if (!p.projectRoot || !p.name) throw new Error('projectRoot and name are required')
    gitCreateTag(p.projectRoot, p.name, p.message, p.target)
    return gitTags(p.projectRoot)
  })

  rpc.on('git.tag_delete', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; name?: string }
    if (!p.projectRoot || !p.name) throw new Error('projectRoot and name are required')
    gitDeleteTag(p.projectRoot, p.name)
    return gitTags(p.projectRoot)
  })

  rpc.on('git.tag_push', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; name?: string; remote?: string }
    if (!p.projectRoot || !p.name) throw new Error('projectRoot and name are required')
    gitPushTag(p.projectRoot, p.name, p.remote)
    return { ok: true, name: p.name, remote: p.remote ?? gitRemotes(p.projectRoot)[0]?.name ?? 'origin' }
  })

  rpc.on('git.release', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      name?: string
      message?: string
      target?: string
      remote?: string
      github?: boolean
    }
    if (!p.projectRoot || !p.name) throw new Error('projectRoot and name are required')
    const release = gitRelease(p.projectRoot, {
      name: p.name,
      message: p.message,
      target: p.target,
      remote: p.remote,
      github: p.github,
    })
    return {
      ...release,
      tags: gitTags(p.projectRoot),
      status: gitStatus(p.projectRoot),
    }
  })

  rpc.on('git.fetch', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; remote?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    gitFetch(p.projectRoot, p.remote)
    return { remotes: gitRemotes(p.projectRoot), branches: gitBranches(p.projectRoot), status: gitStatus(p.projectRoot) }
  })

  rpc.on('git.pull', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; remote?: string; branch?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    gitPull(p.projectRoot, p.remote, p.branch)
    return { status: gitStatus(p.projectRoot), history: gitHistory(p.projectRoot) }
  })

  rpc.on('git.push', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; remote?: string; branch?: string; setUpstream?: boolean }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    gitPush(p.projectRoot, p.remote, p.branch, p.setUpstream === true)
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.conflicts', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return p.path ? gitConflict(p.projectRoot, p.path) : gitConflicts(p.projectRoot)
  })

  rpc.on('git.resolve_conflict', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string; resolution?: 'ours' | 'theirs' | 'mark' }
    if (!p.projectRoot || !p.path || !p.resolution) throw new Error('projectRoot, path, and resolution are required')
    gitResolveConflict(p.projectRoot, p.path, p.resolution)
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.stage', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string }
    if (!p.projectRoot || !p.path) throw new Error('projectRoot and path are required')
    gitStage(p.projectRoot, p.path)
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.stage_all', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    gitStageAll(p.projectRoot)
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.unstage', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string }
    if (!p.projectRoot || !p.path) throw new Error('projectRoot and path are required')
    gitUnstage(p.projectRoot, p.path)
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.unstage_all', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    gitUnstageAll(p.projectRoot)
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.discard', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string; untracked?: boolean }
    if (!p.projectRoot || !p.path) throw new Error('projectRoot and path are required')
    gitDiscard(p.projectRoot, p.path, p.untracked === true)
    return gitStatus(p.projectRoot)
  })

  rpc.on('git.commit', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; message?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return { content: gitCommit(p.projectRoot, p.message ?? ''), status: gitStatus(p.projectRoot) }
  })

  rpc.on('git.suggest_commit', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return { message: gitCommitSuggestion(p.projectRoot) }
  })

  rpc.on('git.worktree_list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitWorktreeList(p.projectRoot)
  })

  rpc.on('git.worktree_add', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      name?: string
      branch?: string
      startPoint?: string
    }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    return gitWorktreeAdd(p.projectRoot, {
      name: p.name,
      branch: p.branch,
      startPoint: p.startPoint,
    })
  })

  rpc.on('git.worktree_remove', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      path?: string
      force?: boolean
    }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    if (!p.path) throw new Error('path is required')
    return gitWorktreeRemove(p.projectRoot, p.path, Boolean(p.force))
  })

  rpc.on('git.worktree_preview', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    if (!p.path) throw new Error('path is required')
    return gitWorktreePreview(p.projectRoot, p.path)
  })

  rpc.on('git.worktree_apply', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; path?: string; remove?: boolean; keepBranch?: boolean }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    if (!p.path) throw new Error('path is required')
    return gitWorktreeApply(p.projectRoot, p.path, {
      remove: p.remove !== false,
      keepBranch: Boolean(p.keepBranch),
    })
  })

  rpc.on('git.worktree_discard', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      path?: string
      deleteBranch?: boolean
    }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    if (!p.path) throw new Error('path is required')
    return gitWorktreeDiscard(p.projectRoot, p.path, { deleteBranch: p.deleteBranch })
  })

  rpc.on('session.upsert', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      sessionId?: string
      title?: string
      permissionMode?: 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
      model?: string
      dialect?: 'anthropic' | 'openai'
      fresh?: boolean
      baseProjectRoot?: string
      worktreeBranch?: string
    }
    if (!p.projectRoot || typeof p.projectRoot !== 'string') {
      throw new Error('projectRoot is required')
    }

    const meta = p.fresh
      ? sessions.create({
          projectRoot: p.projectRoot,
          title: p.title,
          permissionMode: p.permissionMode ?? provider.permissionMode,
          model: p.model ?? provider.model,
          dialect: p.dialect ?? provider.dialect,
          baseProjectRoot: p.baseProjectRoot,
          worktreeBranch: p.worktreeBranch,
        })
      : sessions.upsert({
          projectRoot: p.projectRoot,
          sessionId: p.sessionId,
          title: p.title,
          permissionMode: p.permissionMode ?? provider.permissionMode,
          model: p.model ?? provider.model,
          dialect: p.dialect ?? provider.dialect,
        })

    const runtime = getRuntime(meta.id)!
    runtime.meta = meta
    return {
      ...meta,
      messageCount: runtime.messages.length,
    }
  })

  /** Create managed worktree + fresh agent session jailed to it. */
  rpc.on('session.worktree_start', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      name?: string
      branch?: string
      title?: string
      permissionMode?: 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
    }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const base = path.resolve(p.projectRoot)
    const wt = gitWorktreeAdd(base, { name: p.name, branch: p.branch })
    const branch = wt.branch ?? p.branch ?? 'detached'
    const meta = sessions.create({
      projectRoot: wt.path,
      baseProjectRoot: base,
      worktreeBranch: branch,
      title: p.title ?? `Worktree · ${branch}`,
      permissionMode: p.permissionMode ?? provider.permissionMode,
      model: provider.model,
      dialect: provider.dialect,
    })
    const runtime = getRuntime(meta.id)!
    runtime.meta = meta
    return {
      session: { ...meta, messageCount: 0 },
      worktree: wt,
    }
  })

  /**
   * Open or create a session jailed to an existing worktree path (no new git worktree).
   * Used when Linked worktrees has a tree but no matching chat yet (orphan / empty session).
   */
  rpc.on('session.worktree_open', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      worktreePath?: string
      branch?: string
    }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    if (!p.worktreePath) throw new Error('worktreePath is required')
    const base = path.resolve(p.projectRoot)
    const wtPath = path.resolve(p.worktreePath)
    if (!fs.existsSync(wtPath) || !fs.statSync(wtPath).isDirectory()) {
      throw new Error(`worktree path missing: ${wtPath}`)
    }
    const listed = gitWorktreeList(base)
    const entry = listed.find((w) => path.resolve(w.path) === wtPath)
    if (!entry || entry.main) throw new Error('path is not a linked worktree of this project')

    const branch = (p.branch || entry.branch || path.basename(wtPath)).replace(/^refs\/heads\//, '')
    const existing = sessions
      .list(base)
      .find(
        (s) =>
          path.resolve(s.projectRoot) === wtPath ||
          (s.worktreeBranch && s.worktreeBranch.replace(/^refs\/heads\//, '') === branch),
      )
    if (existing) {
      const runtime = getRuntime(existing.id)!
      runtime.meta = existing
      return {
        session: { ...existing, messageCount: sessions.getMessages(existing.id).length },
        worktree: { path: wtPath, branch },
        created: false,
      }
    }

    const meta = sessions.create({
      projectRoot: wtPath,
      baseProjectRoot: base,
      worktreeBranch: branch,
      title: `Worktree · ${branch}`,
      permissionMode: provider.permissionMode,
      model: provider.model,
      dialect: provider.dialect,
    })
    const runtime = getRuntime(meta.id)!
    runtime.meta = meta
    return {
      session: { ...meta, messageCount: 0 },
      worktree: { path: wtPath, branch },
      created: true,
    }
  })

  /** Spawn N isolated worktree sessions (ClawTeam-style multi-agent). Max 4. */
  rpc.on('session.worktree_start_many', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      count?: number
      prefix?: string
      permissionMode?: 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
    }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const base = path.resolve(p.projectRoot)
    const count = Math.max(1, Math.min(4, Math.floor(p.count ?? 2)))
    const prefix = (p.prefix?.trim() || 'agent').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24)
    const created: {
      session: ReturnType<SessionStore['create']> & { messageCount: number }
      worktree: ReturnType<typeof gitWorktreeAdd>
    }[] = []
    const errors: string[] = []
    for (let i = 1; i <= count; i++) {
      const name = `${prefix}-${i}-${Date.now().toString(36).slice(-4)}`
      try {
        const wt = gitWorktreeAdd(base, { name })
        const branch = wt.branch ?? name
        const meta = sessions.create({
          projectRoot: wt.path,
          baseProjectRoot: base,
          worktreeBranch: branch,
          title: `Agent · ${branch}`,
          permissionMode: p.permissionMode ?? provider.permissionMode,
          model: provider.model,
          dialect: provider.dialect,
        })
        const runtime = getRuntime(meta.id)!
        runtime.meta = meta
        created.push({ session: { ...meta, messageCount: 0 }, worktree: wt })
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    return { ok: created.length > 0, created, errors }
  })

  rpc.on('session.worktree_preview', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    if (!meta.baseProjectRoot) {
      throw new Error(
        'not a worktree session (missing baseProjectRoot) — open a session created via Worktree / ×2',
      )
    }
    return gitWorktreePreview(meta.baseProjectRoot, meta.projectRoot)
  })

  rpc.on('session.worktree_apply', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string; remove?: boolean; keepBranch?: boolean }
    if (!p.sessionId) throw new Error('sessionId is required')
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    if (!meta.baseProjectRoot) {
      throw new Error(
        'not a worktree session (missing baseProjectRoot) — open a session created via Worktree / ×2',
      )
    }
    if (meta.status === 'running' || meta.status === 'awaiting_approval') {
      throw new Error('session is busy')
    }
    const result = gitWorktreeApply(meta.baseProjectRoot, meta.projectRoot, {
      remove: p.remove !== false,
      keepBranch: Boolean(p.keepBranch),
    })
    if (result.conflicts?.length) {
      return { ...result, sessionId: p.sessionId, ok: false }
    }
    if (result.removed) {
      sessions.setStatus(p.sessionId, 'archived')
    }
    return { ...result, sessionId: p.sessionId, ok: true }
  })

  /** Sequential apply of worktree agent sessions into main. Stops on first conflict. */
  rpc.on('session.worktree_apply_many', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      sessionIds?: string[]
      remove?: boolean
      keepBranch?: boolean
    }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const base = path.resolve(p.projectRoot)
    let metas = sessions.list(base).filter((m) => m.baseProjectRoot || m.worktreeBranch)
    if (Array.isArray(p.sessionIds) && p.sessionIds.length) {
      const want = new Set(p.sessionIds)
      metas = metas.filter((m) => want.has(m.id))
    }
    metas = metas.slice(0, 8)
    const results: {
      sessionId: string
      ok: boolean
      skipped?: string
      conflicts?: unknown[]
      removed?: boolean
      branch?: string
    }[] = []
    for (const meta of metas) {
      if (!meta.baseProjectRoot) {
        results.push({ sessionId: meta.id, ok: false, skipped: 'not worktree' })
        continue
      }
      if (meta.status === 'running' || meta.status === 'awaiting_approval') {
        results.push({ sessionId: meta.id, ok: false, skipped: 'busy' })
        continue
      }
      try {
        const preview = gitWorktreePreview(meta.baseProjectRoot, meta.projectRoot)
        if (preview.dirty) {
          results.push({ sessionId: meta.id, ok: false, skipped: 'dirty', branch: meta.worktreeBranch })
          continue
        }
        if (!preview.ahead) {
          results.push({ sessionId: meta.id, ok: false, skipped: 'nothing to apply', branch: meta.worktreeBranch })
          continue
        }
        const result = gitWorktreeApply(meta.baseProjectRoot, meta.projectRoot, {
          remove: p.remove !== false,
          keepBranch: Boolean(p.keepBranch),
        })
        if (result.conflicts?.length) {
          results.push({
            sessionId: meta.id,
            ok: false,
            conflicts: result.conflicts,
            branch: meta.worktreeBranch,
          })
          break
        }
        if (result.removed) sessions.setStatus(meta.id, 'archived')
        results.push({
          sessionId: meta.id,
          ok: true,
          removed: result.removed,
          branch: meta.worktreeBranch,
        })
      } catch (err) {
        results.push({
          sessionId: meta.id,
          ok: false,
          skipped: err instanceof Error ? err.message : String(err),
          branch: meta.worktreeBranch,
        })
      }
    }
    return {
      ok: results.some((r) => r.ok) && !results.some((r) => r.conflicts?.length),
      applied: results.filter((r) => r.ok).length,
      results,
    }
  })

  rpc.on('session.worktree_discard', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string; deleteBranch?: boolean }
    if (!p.sessionId) throw new Error('sessionId is required')
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    if (!meta.baseProjectRoot) {
      throw new Error(
        'not a worktree session (missing baseProjectRoot) — open a session created via Worktree / ×2',
      )
    }
    if (meta.status === 'running' || meta.status === 'awaiting_approval') {
      stopTurn(getRuntime(p.sessionId)!)
      sessions.setStatus(p.sessionId, 'idle')
    }
    const result = gitWorktreeDiscard(meta.baseProjectRoot, meta.projectRoot, {
      deleteBranch: p.deleteBranch,
    })
    sessions.setStatus(p.sessionId, 'archived')
    return { ...result, sessionId: p.sessionId }
  })

  rpc.on('session.get', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const loaded = sessions.loadPersisted(p.sessionId)
    if (!loaded) throw new Error(`session not found: ${p.sessionId}`)
    const runtime = getRuntime(p.sessionId)
    if (runtime) {
      runtime.meta = loaded.meta
      runtime.messages = loaded.messages
    }
    return {
      meta: loaded.meta,
      messages: uiMessagesFromRuntime(loaded.messages),
    }
  })

  rpc.on('session.list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    return sessions.list(p.projectRoot).map((meta) => {
      const messages = sessions.getMessages(meta.id)
      const live = runtimes.get(meta.id)
      const status = live?.meta.status ?? meta.status
      return {
        ...meta,
        status,
        busy: status === 'running' || status === 'awaiting_approval',
        worktree: Boolean(meta.baseProjectRoot || meta.worktreeBranch),
        messageCount: messages.length,
        sizeBytes: Buffer.byteLength(JSON.stringify({ meta, messages }), 'utf8'),
      }
    })
  })

  /** Concurrent worktree agents for a project (ClawTeam-style status board). */
  rpc.on('session.agents', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string }
    if (!p.projectRoot) throw new Error('projectRoot is required')
    const root = path.resolve(p.projectRoot)
    const agents = sessions
      .list(root)
      .filter((m) => m.baseProjectRoot || m.worktreeBranch)
      .map((meta) => {
        const live = runtimes.get(meta.id)
        const status = live?.meta.status ?? meta.status
        return {
          id: meta.id,
          title: meta.title,
          status,
          busy: status === 'running' || status === 'awaiting_approval',
          worktreeBranch: meta.worktreeBranch,
          projectRoot: meta.projectRoot,
          baseProjectRoot: meta.baseProjectRoot,
          model: meta.model,
          updatedAt: meta.updatedAt,
        }
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return {
      count: agents.length,
      busy: agents.filter((a) => a.busy).length,
      agents,
    }
  })

  /** Fan-out same prompt to multiple worktree agent sessions (parallel). */
  rpc.on('session.prompt_many', async (_method, params) => {
    const p = (params ?? {}) as {
      sessionIds?: string[]
      text?: string
      projectRoot?: string
    }
    if (!p.text?.trim()) throw new Error('text is required')
    let ids = Array.isArray(p.sessionIds) ? p.sessionIds.filter((id) => typeof id === 'string') : []
    if (!ids.length && p.projectRoot) {
      const board = sessions
        .list(path.resolve(p.projectRoot))
        .filter((m) => m.baseProjectRoot || m.worktreeBranch)
        .slice(0, 4)
      ids = board.map((m) => m.id)
    }
    if (!ids.length) throw new Error('sessionIds or projectRoot with worktree agents required')
    ids = ids.slice(0, 4)

    const results = await Promise.all(
      ids.map(async (sessionId) => {
        try {
          const meta = sessions.get(sessionId)
          if (!meta) return { sessionId, ok: false as const, error: 'not found' }
          if (meta.status === 'running' || meta.status === 'awaiting_approval') {
            return { sessionId, ok: false as const, error: 'busy' }
          }
          provider = loadProviderConfig(meta.projectRoot)
          assertProviderReady(provider)
          const runtime = getRuntime(sessionId)!
          runtime.meta = meta
          sessions.setStatus(sessionId, 'running')
          const result = await runPromptTurn({
            runtime,
            text: p.text!,
            config: provider,
            goal: p.text,
            emit: (event) => rpc.notify('event', event),
            setStatus: (status) => sessions.setStatus(sessionId, status),
          })
          sessions.setMessages(sessionId, runtime.messages)
          sessions.addUsage(sessionId, result.usage)
          sessions.setStatus(sessionId, 'idle')
          return { sessionId, ok: true as const, content: result.content?.slice(0, 500) }
        } catch (err) {
          sessions.setStatus(sessionId, 'idle')
          return {
            sessionId,
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }),
    )
    return {
      ok: results.some((r) => r.ok),
      results,
    }
  })

  rpc.on('session.prompt', async (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string; text?: string; goal?: unknown; images?: { name?: unknown; mime?: unknown; dataUrl?: unknown }[] }
    if (!p.sessionId) throw new Error('sessionId is required')
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    if (!p.text?.trim()) throw new Error('text is required')
    // Per-session lock only — other sessions may run in parallel.
    if (meta.status === 'running' || meta.status === 'awaiting_approval') {
      throw new Error('session is busy')
    }
    const images = (Array.isArray(p.images) ? p.images : []).map((image) => ({
      name: typeof image.name === 'string' ? image.name.slice(0, 200) : 'image',
      mime: typeof image.mime === 'string' ? image.mime : '',
      dataUrl: typeof image.dataUrl === 'string' ? image.dataUrl : '',
    })).filter((image) => /^image\/(?:png|jpeg|webp|gif)$/.test(image.mime) && image.dataUrl.startsWith(`data:${image.mime};base64,`) && image.dataUrl.length <= 8_000_000).slice(0, 4)

    // Reload user + project TOML overlay for this session root
    provider = loadProviderConfig(meta.projectRoot)
    assertProviderReady(provider)

    const runtime = getRuntime(p.sessionId)!
    runtime.meta = meta

    try {
      sessions.setStatus(p.sessionId, 'running')
      const result = await runPromptTurn({
        runtime,
        text: p.text,
        config: provider,
        goal: p.goal ?? p.text,
        images,
        emit: (event) => rpc.notify('event', event),
        setStatus: (status) => sessions.setStatus(p.sessionId!, status),
      })
      sessions.setMessages(p.sessionId, runtime.messages)
      const sessionUsage = sessions.addUsage(p.sessionId, result.usage)
      if (sessionUsage) {
        rpc.notify('event', {
          type: 'session_usage',
          sessionId: p.sessionId,
          usage: {
            prompt_tokens: sessionUsage.prompt,
            completion_tokens: sessionUsage.completion,
            total_tokens: sessionUsage.total,
          },
        })
      }
      sessions.setStatus(p.sessionId, 'idle')
      return { ok: true, content: result.content, usage: result.usage, sessionUsage }
    } catch (err) {
      sessions.setMessages(p.sessionId, runtime.messages)
      sessions.setStatus(p.sessionId, 'error')
      const message = err instanceof Error ? err.message : String(err)
      rpc.notify('event', {
        type: 'error',
        sessionId: p.sessionId,
        message,
      })
      rpc.notify('event', {
        type: 'status',
        sessionId: p.sessionId,
        status: 'error',
        detail: message,
      })
      throw err
    }
  })

  rpc.on('session.set_load_memory', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string; loadMemory?: boolean }
    if (!p.sessionId) throw new Error('sessionId is required')
    if (typeof p.loadMemory !== 'boolean') throw new Error('loadMemory boolean required')
    const meta = sessions.setLoadMemory(p.sessionId, p.loadMemory)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    const runtime = getRuntime(p.sessionId)
    if (runtime) runtime.meta = meta
    return meta
  })

  rpc.on('session.compact', async (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    if (meta.status === 'running' || meta.status === 'awaiting_approval') throw new Error('session is busy')
    assertProviderReady(provider)
    const runtime = getRuntime(p.sessionId)!
    runtime.meta = meta
    sessions.setStatus(p.sessionId, 'running')
    try {
      const result = await compactRuntime({ runtime, config: provider })
      sessions.setMessages(p.sessionId, runtime.messages)
      sessions.setStatus(p.sessionId, 'idle')
      rpc.notify('event', {
        type: 'session_compacted',
        sessionId: p.sessionId,
        originalMessageCount: result.originalMessageCount,
        canUndo: true,
        summary: result.summary.slice(0, 500),
      })
      return { ok: true, ...result, messageCount: runtime.messages.length }
    } catch (err) {
      sessions.setStatus(p.sessionId, 'error')
      throw err
    }
  })

  rpc.on('session.compact_undo', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    if (meta.status === 'running' || meta.status === 'awaiting_approval') throw new Error('session is busy')
    const runtime = getRuntime(p.sessionId)
    if (!runtime) throw new Error(`session runtime not found: ${p.sessionId}`)
    runtime.meta = meta
    const result = undoCompactRuntime(runtime)
    sessions.setMessages(p.sessionId, runtime.messages)
    sessions.setStatus(p.sessionId, 'idle')
    rpc.notify('event', {
      type: 'session_compact_undone',
      sessionId: p.sessionId,
      messageCount: result.messageCount,
    })
    return {
      ok: true,
      messageCount: result.messageCount,
      messages: uiMessagesFromRuntime(runtime.messages),
    }
  })

  rpc.on('session.export', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const loaded = sessions.loadPersisted(p.sessionId)
    const meta = sessions.get(p.sessionId) ?? loaded?.meta
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    const runtime = getRuntime(p.sessionId)
    const messages = (runtime?.messages?.length ? runtime.messages : null)
      ?? (sessions.getMessages(p.sessionId).length ? sessions.getMessages(p.sessionId) : null)
      ?? loaded?.messages
      ?? []
    const lines = [
      `# ${meta.title}`,
      '',
      `- session: \`${meta.id}\``,
      `- project: \`${meta.baseProjectRoot ?? meta.projectRoot}\``,
      meta.worktreeBranch ? `- worktree: \`${meta.worktreeBranch}\`` : '',
      `- model: \`${meta.model}\``,
      `- updated: ${meta.updatedAt}`,
      '',
      '---',
      '',
    ].filter(Boolean)
    for (const message of messages) {
      const role = message.role ?? 'unknown'
      let body = ''
      if (typeof message.content === 'string') body = message.content
      else if (Array.isArray(message.content)) {
        body = message.content
          .map((part) => {
            if (typeof part === 'string') return part
            if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: string }).text ?? '')
            return ''
          })
          .filter(Boolean)
          .join('\n')
      }
      if (message.tool_calls?.length) {
        body = [body, ...message.tool_calls.map((call) => {
          const fn = (call as { function?: { name?: string; arguments?: string } }).function
          return `tool_call ${fn?.name ?? '?'}: ${fn?.arguments ?? ''}`
        })].filter(Boolean).join('\n')
      }
      lines.push(`## ${role}`, '', body.trim() || '_(empty)_', '')
    }
    return {
      ok: true,
      sessionId: meta.id,
      title: meta.title,
      markdown: `${lines.join('\n').trim()}\n`,
      messageCount: messages.length,
    }
  })

  rpc.on('session.edit_file', async (_method, params) => {
    const p = (params ?? {}) as {
      sessionId?: string
      path?: string
      expectedContent?: string
      content?: string
    }
    if (!p.sessionId) throw new Error('sessionId is required')
    if (!p.path) throw new Error('path is required')
    if (typeof p.expectedContent !== 'string' || typeof p.content !== 'string') {
      throw new Error('expectedContent and content are required')
    }
    const meta = sessions.get(p.sessionId)
    if (!meta) throw new Error(`session not found: ${p.sessionId}`)
    const runtime = getRuntime(p.sessionId)!
    const codeEditPending = [...(runtime.pendingApprovals?.keys() ?? [])]
      .find((id) => id.startsWith('code_edit_'))
    if (meta.status === 'awaiting_approval' && codeEditPending) {
      resolveApproval(runtime, codeEditPending, 'deny')
      sessions.setStatus(p.sessionId, 'idle')
    }
    if (meta.status === 'running' || meta.status === 'awaiting_approval') {
      throw new Error('session is busy')
    }
    runtime.meta = meta
    try {
      return await runDirectEdit({
        runtime,
        path: p.path,
        expectedContent: p.expectedContent,
        content: p.content,
        emit: (event) => rpc.notify('event', event),
        setStatus: (status) => sessions.setStatus(p.sessionId!, status),
      })
    } finally {
      sessions.setMessages(p.sessionId, runtime.messages)
      sessions.setStatus(p.sessionId, 'idle')
    }
  })

  rpc.on('session.approve', (_method, params) => {
    const p = (params ?? {}) as {
      sessionId?: string
      requestId?: string
      decision?: 'allow' | 'deny'
      scope?: 'once' | 'session'
    }
    if (!p.sessionId) throw new Error('sessionId is required')
    if (!p.requestId) throw new Error('requestId is required')
    if (p.decision !== 'allow' && p.decision !== 'deny') {
      throw new Error('decision must be allow|deny')
    }
    const scope = p.scope === 'session' ? 'session' : 'once'
    const runtime = runtimes.get(p.sessionId)
    if (!runtime) throw new Error(`session not running: ${p.sessionId}`)
    const ok = resolveApproval(runtime, p.requestId, p.decision, scope)
    if (!ok) throw new Error(`no pending approval: ${p.requestId}`)
    return { ok: true, decision: p.decision, scope }
  })

  rpc.on('session.approve_all', (_method, params) => {
    const p = (params ?? {}) as {
      sessionId?: string
      decision?: 'allow' | 'deny'
      scope?: 'once' | 'session'
    }
    if (!p.sessionId) throw new Error('sessionId is required')
    if (p.decision !== 'allow' && p.decision !== 'deny') {
      throw new Error('decision must be allow|deny')
    }
    const scope = p.scope === 'session' ? 'session' : 'once'
    const runtime = runtimes.get(p.sessionId)
    if (!runtime) throw new Error(`session not running: ${p.sessionId}`)
    const count = resolveAllApprovals(runtime, p.decision, scope)
    return { ok: true, decision: p.decision, scope, count }
  })

  rpc.on('session.answer', (_method, params) => {
    const p = (params ?? {}) as {
      sessionId?: string
      requestId?: string
      answer?: string
    }
    if (!p.sessionId) throw new Error('sessionId is required')
    if (!p.requestId) throw new Error('requestId is required')
    const runtime = runtimes.get(p.sessionId)
    if (!runtime) throw new Error(`session not running: ${p.sessionId}`)
    const ok = resolveAnswer(runtime, p.requestId, String(p.answer ?? ''))
    if (!ok) throw new Error(`no pending question: ${p.requestId}`)
    return { ok: true }
  })

  rpc.on('session.stop', (_method, params) => {
    const p = (params ?? {}) as { sessionId?: string }
    if (!p.sessionId) throw new Error('sessionId is required')
    const runtime = runtimes.get(p.sessionId)
    if (runtime) {
      stopTurn(runtime)
      sessions.setMessages(p.sessionId, runtime.messages)
    }
    sessions.setStatus(p.sessionId, 'idle')
    rpc.notify('event', {
      type: 'status',
      sessionId: p.sessionId,
      status: 'idle',
      detail: 'stopped',
    })
    return { ok: true }
  })

  async function fireCronJob(due: DueCronJob): Promise<void> {
    const root = path.resolve(due.projectRoot)
    const job = due.job
    try {
      provider = loadProviderConfig(root)
      assertProviderReady(provider)
      const meta = sessions.create({
        projectRoot: root,
        title: `cron:${job.name}`,
        permissionMode: provider.permissionMode,
        model: provider.model,
        dialect: provider.dialect,
      })
      const runtime = getRuntime(meta.id)!
      rpc.notify('event', {
        type: 'cron_fire',
        sessionId: meta.id,
        projectRoot: root,
        jobId: job.id,
        name: job.name,
        prompt: job.prompt.slice(0, 200),
      })
      sessions.setStatus(meta.id, 'running')
      const result = await runPromptTurn({
        runtime,
        text: job.prompt,
        config: provider,
        goal: job.prompt,
        emit: (event) => rpc.notify('event', event),
        setStatus: (status) => sessions.setStatus(meta.id, status),
      })
      sessions.setMessages(meta.id, runtime.messages)
      sessions.addUsage(meta.id, result.usage)
      sessions.setStatus(meta.id, 'idle')
      cronMarkRan(root, job.id, { ok: true, sessionId: meta.id })
      rpc.notify('event', {
        type: 'cron_done',
        sessionId: meta.id,
        projectRoot: root,
        jobId: job.id,
        name: job.name,
        ok: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      cronMarkRan(root, job.id, { ok: false, error: message })
      rpc.notify('event', {
        type: 'cron_done',
        projectRoot: root,
        jobId: job.id,
        name: job.name,
        ok: false,
        error: message.slice(0, 300),
      })
    }
  }

  rpc.on('cron.list', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; enabled?: boolean }
    if (!p.projectRoot?.trim()) throw new Error('projectRoot is required')
    const r = cronList(path.resolve(p.projectRoot), {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : undefined,
    })
    return { jobs: r.jobs }
  })

  rpc.on('cron.create', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      name?: string
      schedule?: string
      prompt?: string
      message?: string
      enabled?: boolean
    }
    if (!p.projectRoot?.trim()) throw new Error('projectRoot is required')
    const r = cronCreate(path.resolve(p.projectRoot), {
      name: p.name,
      schedule: p.schedule,
      prompt: p.prompt,
      message: p.message,
      enabled: p.enabled,
    })
    if (!r.ok) throw new Error(r.content)
    return { job: r.job }
  })

  rpc.on('cron.delete', (_method, params) => {
    const p = (params ?? {}) as { projectRoot?: string; id?: string; name?: string }
    if (!p.projectRoot?.trim()) throw new Error('projectRoot is required')
    const r = cronDelete(path.resolve(p.projectRoot), String(p.id ?? p.name ?? ''))
    if (!r.ok) throw new Error(r.content)
    return { ok: true }
  })

  rpc.on('cron.toggle', (_method, params) => {
    const p = (params ?? {}) as {
      projectRoot?: string
      id?: string
      name?: string
      enabled?: boolean
    }
    if (!p.projectRoot?.trim()) throw new Error('projectRoot is required')
    const r = cronToggle(
      path.resolve(p.projectRoot),
      String(p.id ?? p.name ?? ''),
      typeof p.enabled === 'boolean' ? p.enabled : undefined,
    )
    if (!r.ok) throw new Error(r.content)
    return { job: r.job }
  })

  startCronScheduler((due) => fireCronJob(due))

  process.on('exit', () => {
    stopCronScheduler()
    mcpDisconnectAll()
    stopAllTunnels()
  })
  process.on('SIGINT', () => {
    stopCronScheduler()
    mcpDisconnectAll()
    stopAllTunnels()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    stopCronScheduler()
    mcpDisconnectAll()
    stopAllTunnels()
    process.exit(0)
  })

  console.error(
    `[enpii] sidecar ready pid=${process.pid} v${VERSION} model=${provider.model} base=${provider.baseUrl} key=${provider.apiKey ? 'yes' : 'no'}`,
  )
  rpc.start()
}

main().catch((err) => {
  console.error('[enpii] fatal', err)
  process.exit(1)
})
