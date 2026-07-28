import {
  state,
  type AgentCheckpoint,
  type ChatMessage,
  type PermissionMode,
  type ProviderDialect,
} from './store.svelte'

let hydrateInFlight: Promise<void> | null = null

export async function respondApproval(
  decision: 'allow' | 'deny',
  requestId?: string,
  scope: 'once' | 'session' = 'once',
): Promise<void> {
  const a = requestId
    ? state.pendingApprovals.find((x) => x.requestId === requestId) ?? null
    : state.approval
  if (!a) return
  try {
    await window.enpiistudio.enpii.request('session.approve', {
      sessionId: a.sessionId,
      requestId: a.requestId,
      decision,
      scope: decision === 'allow' ? scope : 'once',
    })
    const label = decision === 'allow' && scope === 'session' ? 'allow-session' : decision
    state.pushLog(`[approval] ${label} ${a.name}`)
    state.approvals = [{ requestId: a.requestId, toolCallId: a.toolCallId, name: a.name, summary: a.summary, preview: a.preview, args: a.args, decision, ts: Date.now() }, ...state.approvals].slice(0, 50)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[approval] failed: ${message}`)
    state.notify('error', 'Approval failed', message)
  } finally {
    state.clearApproval(a.requestId)
  }
}

export async function respondAllApprovals(
  decision: 'allow' | 'deny',
  scope: 'once' | 'session' = 'once',
): Promise<void> {
  const queue = [...state.pendingApprovals]
  if (!queue.length) return
  const sessionId = queue[0].sessionId
  try {
    await window.enpiistudio.enpii.request('session.approve_all', {
      sessionId,
      decision,
      scope: decision === 'allow' ? scope : 'once',
    })
    const label = decision === 'allow' && scope === 'session' ? 'allow-session' : decision
    state.pushLog(`[approval] ${label} all (${queue.length})`)
    const now = Date.now()
    state.approvals = [
      ...queue.map((a) => ({
        requestId: a.requestId,
        toolCallId: a.toolCallId,
        name: a.name,
        summary: a.summary,
        preview: a.preview,
        args: a.args,
        decision,
        ts: now,
      })),
      ...state.approvals,
    ].slice(0, 50)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[approval] batch failed: ${message}`)
    state.notify('error', 'Batch approval failed', message)
  } finally {
    state.clearApproval()
  }
}

export async function respondAsk(answer: string, requestId?: string): Promise<void> {
  const a = requestId
    ? state.pendingAsks.find((x) => x.requestId === requestId) ?? null
    : state.ask
  if (!a) return
  try {
    await window.enpiistudio.enpii.request('session.answer', {
      sessionId: a.sessionId,
      requestId: a.requestId,
      answer,
    })
    state.pushLog(`[ask] answered: ${answer.slice(0, 80)}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[ask] failed: ${message}`)
    state.notify('error', 'Answer failed', message)
  } finally {
    state.clearAsk(a.requestId)
  }
}

export type ProviderPublic = {
  baseUrl: string
  model: string
  models?: string[]
  dialect: ProviderDialect
  permissionMode: PermissionMode
  denyGlobs?: string[]
  hasKey: boolean
  envOverrides: {
    baseUrl: boolean
    apiKey: boolean
    model: boolean
    dialect: boolean
  }
}

function applyProvider(cfg: ProviderPublic, healthPrefix?: string): void {
  state.provider = cfg
  const base = healthPrefix ?? state.enpiiInfo.replace(/\s·\s[^·]+·\skey\s(ok|missing).*$/, '').trim()
  const head = base || cfg.model
  state.enpiiInfo = `${head} · ${cfg.model} · key ${cfg.hasKey ? 'ok' : 'missing'}`
}

export async function loadProviderConfig(): Promise<ProviderPublic | null> {
  try {
    const cfg = (await window.enpiistudio.enpii.request('config.get')) as ProviderPublic
    applyProvider(cfg)
    return cfg
  } catch (err) {
    state.pushLog(
      `[config] get failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

export async function saveProviderConfig(patch: {
  baseUrl?: string
  apiKey?: string
  model?: string
  models?: string[]
  dialect?: ProviderDialect
  permissionMode?: PermissionMode
  denyGlobs?: string[]
}): Promise<ProviderPublic> {
  const cfg = (await window.enpiistudio.enpii.request(
    'config.set',
    patch,
  )) as ProviderPublic
  applyProvider(cfg)
  state.pushLog(
    `[config] saved model=${cfg.model} mode=${cfg.permissionMode} key=${cfg.hasKey ? 'ok' : 'missing'}`,
  )
  return cfg
}

export type SshTunnelInfo = {
  name: string
  host: string
  localPort: number
  remoteHost: string
  remotePort: number
  running: boolean
  pid?: number
}

export type SshHostInfo = {
  name: string
  host: string
  user?: string
  port: number
  identityFile?: string
}

export async function listSsh(): Promise<{
  configPath?: string
  hosts: SshHostInfo[]
  tunnels: SshTunnelInfo[]
  live: { name: string; pid?: number; startedAt: string; summary: string; lastError?: string }[]
}> {
  return (await window.enpiistudio.enpii.request('ssh.list')) as {
    configPath?: string
    hosts: SshHostInfo[]
    tunnels: SshTunnelInfo[]
    live: { name: string; pid?: number; startedAt: string; summary: string; lastError?: string }[]
  }
}

export async function upsertSshHost(input: {
  name: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  previousName?: string
}): Promise<{ name: string }> {
  return (await window.enpiistudio.enpii.request('ssh.host_upsert', input)) as { name: string }
}

export async function deleteSshHost(name: string): Promise<{ deleted: boolean }> {
  return (await window.enpiistudio.enpii.request('ssh.host_delete', { name })) as { deleted: boolean }
}

export type McpServerInfo = {
  name: string
  transport?: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  headerKeys?: string[]
}

export async function listMcpServers(projectRoot?: string): Promise<McpServerInfo[]> {
  const root = projectRoot ?? state.activeProject?.path
  const res = (await window.enpiistudio.enpii.request('mcp.list_servers', {
    projectRoot: root,
  })) as { servers?: McpServerInfo[] }
  return res.servers ?? []
}

export async function startSshTunnel(name: string): Promise<{ ok: true; name: string; pid?: number; alreadyRunning?: boolean }> {
  const res = (await window.enpiistudio.enpii.request('ssh.tunnel_start', { name })) as {
    ok: true
    name: string
    pid?: number
    alreadyRunning?: boolean
  }
  state.pushLog(`[ssh] tunnel start ${name} pid=${res.pid ?? '?'}`)
  return res
}

export async function stopSshTunnel(name: string): Promise<{ ok: true; stopped: boolean }> {
  const res = (await window.enpiistudio.enpii.request('ssh.tunnel_stop', { name })) as {
    ok: true
    stopped: boolean
  }
  state.pushLog(`[ssh] tunnel stop ${name} stopped=${res.stopped}`)
  return res
}

/** Plan interactive ssh argv for a named host (for Terminal PTY). */
export async function planSshHost(host: string): Promise<{ command: string; args: string[]; summary: string }> {
  return (await window.enpiistudio.enpii.request('ssh.plan', { host })) as {
    command: string
    args: string[]
    summary: string
  }
}

export type WorktreeConflict = { path: string; base: string; ours: string; theirs: string }

export type ApplyManyResult = {
  ok: boolean
  applied: number
  results: {
    sessionId: string
    ok: boolean
    skipped?: string
    branch?: string
    conflicts?: WorktreeConflict[]
    removed?: boolean
  }[]
}

export async function applyWorktreeAgents(opts?: {
  sessionIds?: string[]
  remove?: boolean
  keepBranch?: boolean
}): Promise<ApplyManyResult> {
  const project = state.activeProject
  if (!project) throw new Error('no project')
  const res = (await window.enpiistudio.enpii.request('session.worktree_apply_many', {
    projectRoot: project.path,
    sessionIds: opts?.sessionIds,
    remove: opts?.remove,
    keepBranch: opts?.keepBranch,
  })) as ApplyManyResult
  const conflictHit = res.results.find((r) => r.conflicts?.length)
  if (conflictHit?.conflicts?.length) {
    state.pushLog(
      `[worktree+] conflicts on ${conflictHit.branch ?? conflictHit.sessionId}: ${conflictHit.conflicts.map((c) => c.path).join(', ')}`,
    )
  }
  state.pushLog(`[worktree+] apply-many applied=${res.applied} ok=${res.ok}`)
  await refreshSessionList()
  return res
}

export async function pingEnpii(): Promise<void> {
  try {
    const res = (await window.enpiistudio.enpii.request('health')) as {
      ok: boolean
      name: string
      version: string
      pid: number
    }
    state.enpiiStatus = res.ok ? 'ok' : 'error'
    const health = `${res.name} v${res.version} · pid ${res.pid}`
    state.enpiiInfo = health
    try {
      const cfg = (await window.enpiistudio.enpii.request('config.get')) as ProviderPublic
      applyProvider(cfg, health)
    } catch {
      /* older sidecar */
    }
  } catch (err) {
    state.enpiiStatus = 'error'
    state.enpiiInfo = err instanceof Error ? err.message : String(err)
  }
}

export async function listProjectDir(projectRoot: string, dir = '.'): Promise<{ content: string }> {
  return (await window.enpiistudio.enpii.request('project.list_dir', {
    projectRoot,
    path: dir,
  })) as { content: string }
}

export async function readProjectFile(projectRoot: string, file: string): Promise<{ content: string }> {
  return (await window.enpiistudio.enpii.request('project.read_file', {
    projectRoot,
    path: file,
    // Code editor: user-initiated open may include .env / keys. Agent tools still denied.
    bypassDeny: true,
  })) as { content: string }
}

export async function searchProjectFiles(projectRoot: string, query: string): Promise<{ content: string }> {
  return (await window.enpiistudio.enpii.request('project.search_files', {
    projectRoot,
    query,
  })) as { content: string }
}

export async function createProjectEntry(projectRoot: string, dir: string, name: string, kind: 'file' | 'directory'): Promise<{ path: string }> {
  return (await window.enpiistudio.enpii.request('project.create_entry', {
    projectRoot,
    dir,
    name,
    kind,
  })) as { path: string }
}

export type ProjectDiagnostic = {
  path: string
  line: number
  column: number
  severity: 'error' | 'warning'
  source: 'typescript' | 'eslint' | 'php' | 'python'
  code?: string
  message: string
}

export async function getProjectDiagnostics(projectRoot: string, path?: string): Promise<ProjectDiagnostic[]> {
  return await window.enpiistudio.enpii.request('project.diagnostics', { projectRoot, path }) as ProjectDiagnostic[]
}

export async function formatProjectFile(projectRoot: string, path: string, content: string): Promise<{ content: string; formatter: string }> {
  return await window.enpiistudio.enpii.request('project.format_file', { projectRoot, path, content }) as { content: string; formatter: string }
}

export type GitFileStatus = {
  path: string
  index: string
  worktree: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

export type GitStatus = {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export type GitCommit = {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

export type GitCommitFile = {
  path: string
  status: string
}

export type GitBranch = {
  name: string
  current: boolean
  remote: boolean
  upstream?: string
}

export type GitBranchMutation = { branches: GitBranch[]; status: GitStatus }

export type GitStash = {
  ref: string
  message: string
  branch: string
  date: string
}

export type GitStashMutation = { stashes: GitStash[]; status: GitStatus }

export type GitRemote = {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type GitTag = {
  name: string
  hash: string
  shortHash: string
  subject: string
  date: string
  annotated: boolean
}

export type GitConflict = {
  path: string
  base: string
  ours: string
  theirs: string
}

export async function getGitStatus(projectRoot: string): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.status', { projectRoot }) as GitStatus
}

export async function getGitDiff(projectRoot: string, path: string, staged: boolean): Promise<string> {
  const result = await window.enpiistudio.enpii.request('git.diff', { projectRoot, path, staged }) as { content: string }
  return result.content
}

export async function getGitHistory(projectRoot: string): Promise<GitCommit[]> {
  return await window.enpiistudio.enpii.request('git.history', { projectRoot, limit: 50 }) as GitCommit[]
}

export async function getGitCommitDiff(projectRoot: string, hash: string, path?: string): Promise<string> {
  const result = await window.enpiistudio.enpii.request('git.commit_diff', { projectRoot, hash, path }) as { content: string }
  return result.content
}

export async function getGitCommitFiles(projectRoot: string, hash: string): Promise<GitCommitFile[]> {
  return await window.enpiistudio.enpii.request('git.commit_files', { projectRoot, hash }) as GitCommitFile[]
}

export async function getGitBranches(projectRoot: string): Promise<GitBranch[]> {
  return await window.enpiistudio.enpii.request('git.branch_list', { projectRoot }) as GitBranch[]
}

export async function createGitBranch(projectRoot: string, name: string): Promise<GitBranchMutation> {
  return await window.enpiistudio.enpii.request('git.branch_create', { projectRoot, name }) as GitBranchMutation
}

export async function switchGitBranch(projectRoot: string, branch: GitBranch): Promise<GitBranchMutation> {
  return await window.enpiistudio.enpii.request('git.branch_switch', { projectRoot, name: branch.name, remote: branch.remote }) as GitBranchMutation
}

export async function stashAndSwitchGitBranch(projectRoot: string, branch: GitBranch): Promise<GitBranchMutation & { stashes: GitStash[] }> {
  return await window.enpiistudio.enpii.request('git.branch_switch_stash', { projectRoot, name: branch.name, remote: branch.remote }) as GitBranchMutation & { stashes: GitStash[] }
}

export async function renameGitBranch(projectRoot: string, oldName: string, newName: string): Promise<GitBranchMutation> {
  return await window.enpiistudio.enpii.request('git.branch_rename', { projectRoot, oldName, newName }) as GitBranchMutation
}

export async function deleteGitBranch(projectRoot: string, name: string): Promise<GitBranch[]> {
  return await window.enpiistudio.enpii.request('git.branch_delete', { projectRoot, name }) as GitBranch[]
}

export async function getGitStashes(projectRoot: string): Promise<GitStash[]> {
  return await window.enpiistudio.enpii.request('git.stash_list', { projectRoot }) as GitStash[]
}

export async function createGitStash(projectRoot: string, message: string, includeUntracked: boolean): Promise<GitStashMutation> {
  return await window.enpiistudio.enpii.request('git.stash_create', { projectRoot, message, includeUntracked }) as GitStashMutation
}

export async function applyGitStash(projectRoot: string, ref: string, pop: boolean): Promise<GitStashMutation> {
  return await window.enpiistudio.enpii.request('git.stash_apply', { projectRoot, ref, pop }) as GitStashMutation
}

export async function dropGitStash(projectRoot: string, ref: string): Promise<GitStash[]> {
  return await window.enpiistudio.enpii.request('git.stash_drop', { projectRoot, ref }) as GitStash[]
}

export async function getGitRemotes(projectRoot: string): Promise<GitRemote[]> {
  return await window.enpiistudio.enpii.request('git.remote_list', { projectRoot }) as GitRemote[]
}

export async function getGitTags(projectRoot: string): Promise<GitTag[]> {
  return await window.enpiistudio.enpii.request('git.tag_list', { projectRoot }) as GitTag[]
}

export async function createGitTag(projectRoot: string, name: string, message?: string, target?: string): Promise<GitTag[]> {
  return await window.enpiistudio.enpii.request('git.tag_create', { projectRoot, name, message, target }) as GitTag[]
}

export async function deleteGitTag(projectRoot: string, name: string): Promise<GitTag[]> {
  return await window.enpiistudio.enpii.request('git.tag_delete', { projectRoot, name }) as GitTag[]
}

export type GitReleaseResult = {
  tag: string
  remote: string
  target: string
  annotated: boolean
  pushed: boolean
  githubUrl?: string
  githubSkipped?: string
  tags: GitTag[]
  status: GitStatus
}

export async function createGitRelease(
  projectRoot: string,
  name: string,
  message?: string,
  target = 'HEAD',
  remote?: string,
  github = true,
): Promise<GitReleaseResult> {
  return await window.enpiistudio.enpii.request('git.release', {
    projectRoot,
    name,
    message,
    target,
    remote,
    github,
  }) as GitReleaseResult
}

export async function fetchGit(projectRoot: string, remote?: string): Promise<{ remotes: GitRemote[]; branches: GitBranch[]; status: GitStatus }> {
  return await window.enpiistudio.enpii.request('git.fetch', { projectRoot, remote }) as { remotes: GitRemote[]; branches: GitBranch[]; status: GitStatus }
}

export async function pullGit(projectRoot: string, remote?: string, branch?: string): Promise<{ status: GitStatus; history: GitCommit[] }> {
  return await window.enpiistudio.enpii.request('git.pull', { projectRoot, remote, branch }) as { status: GitStatus; history: GitCommit[] }
}

export async function pushGit(projectRoot: string, remote?: string, branch?: string, setUpstream = false): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.push', { projectRoot, remote, branch, setUpstream }) as GitStatus
}

export async function getGitConflicts(projectRoot: string): Promise<GitConflict[]> {
  return await window.enpiistudio.enpii.request('git.conflicts', { projectRoot }) as GitConflict[]
}

export async function getGitConflict(projectRoot: string, path: string): Promise<GitConflict> {
  return await window.enpiistudio.enpii.request('git.conflicts', { projectRoot, path }) as GitConflict
}

export async function resolveGitConflict(projectRoot: string, path: string, resolution: 'ours' | 'theirs' | 'mark'): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.resolve_conflict', { projectRoot, path, resolution }) as GitStatus
}

export async function stageGitFile(projectRoot: string, path: string): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.stage', { projectRoot, path }) as GitStatus
}

export async function stageAllGitFiles(projectRoot: string): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.stage_all', { projectRoot }) as GitStatus
}

export async function unstageGitFile(projectRoot: string, path: string): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.unstage', { projectRoot, path }) as GitStatus
}

export async function unstageAllGitFiles(projectRoot: string): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.unstage_all', { projectRoot }) as GitStatus
}

export async function discardGitFile(projectRoot: string, path: string, untracked: boolean): Promise<GitStatus> {
  return await window.enpiistudio.enpii.request('git.discard', { projectRoot, path, untracked }) as GitStatus
}

export async function commitGitFiles(projectRoot: string, message: string): Promise<{ content: string; status: GitStatus }> {
  return await window.enpiistudio.enpii.request('git.commit', { projectRoot, message }) as { content: string; status: GitStatus }
}

export async function suggestGitCommit(projectRoot: string): Promise<string> {
  const result = await window.enpiistudio.enpii.request('git.suggest_commit', { projectRoot }) as { message: string }
  return result.message
}

export async function getAgentCheckpoints(projectRoot: string): Promise<AgentCheckpoint[]> {
  return await window.enpiistudio.enpii.request('checkpoint.list', { projectRoot }) as AgentCheckpoint[]
}

export async function rollbackAgentCheckpoint(projectRoot: string, checkpointId: string, path?: string): Promise<AgentCheckpoint[]> {
  return await window.enpiistudio.enpii.request('checkpoint.rollback', { projectRoot, checkpointId, path }) as AgentCheckpoint[]
}

export async function acceptAgentCheckpoint(projectRoot: string, checkpointId: string, path?: string): Promise<AgentCheckpoint[]> {
  return await window.enpiistudio.enpii.request('checkpoint.accept', { projectRoot, checkpointId, path }) as AgentCheckpoint[]
}

export async function editProjectFileExact(path: string, expectedContent: string, content: string): Promise<void> {
  const sessionId = await ensureSession()
  if (!sessionId) throw new Error('Open a project first')
  state.busy = true
  try {
    await window.enpiistudio.enpii.request('session.edit_file', {
      sessionId,
      path,
      expectedContent,
      content,
    })
  } finally {
    state.busy = false
  }
}

function mapDiskMessages(
  rows: {
    role: string
    content: string
    toolName?: string
    summary?: string
    preview?: string
    ok?: boolean
  }[],
): ChatMessage[] {
  return rows.map((r) => {
    if (r.role === 'tool') {
      const summary = r.summary ?? r.content.slice(0, 120)
      const ok = r.ok !== false
      return {
        id: crypto.randomUUID(),
        role: 'tool' as const,
        text: summary,
        ts: Date.now(),
        tool: {
          callId: crypto.randomUUID(),
          name: r.toolName ?? 'tool',
          status: ok ? ('ok' as const) : ('error' as const),
          summary,
          preview: r.preview ?? r.content.slice(0, 500),
        },
      }
    }
    return {
      id: crypto.randomUUID(),
      role: (r.role === 'user' || r.role === 'assistant' || r.role === 'system'
        ? r.role
        : 'assistant') as ChatMessage['role'],
      text: r.content,
      ts: Date.now(),
    }
  })
}

function toolPath(args?: string): string | undefined {
  if (!args) return undefined
  try {
    const value = JSON.parse(args) as { path?: unknown }
    return typeof value.path === 'string' && value.path.trim() ? value.path.trim() : undefined
  } catch {
    return undefined
  }
}

export async function refreshSessionList(): Promise<void> {
  const project = state.activeProject
  if (!project) {
    state.sessionList = []
    return
  }
  try {
    const list = (await window.enpiistudio.enpii.request('session.list', {
      projectRoot: project.path,
    })) as {
      id: string
      title: string
      status: string
      model: string
      projectRoot?: string
      baseProjectRoot?: string
      worktreeBranch?: string
      updatedAt?: string
      messageCount?: number
      sizeBytes?: number
      busy?: boolean
      worktree?: boolean
      usage?: { prompt?: number; completion?: number; total?: number }
    }[]
    const mapped = list.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      model: s.model,
      projectRoot: s.projectRoot,
      baseProjectRoot: s.baseProjectRoot,
      worktreeBranch: s.worktreeBranch,
      messageCount: s.messageCount,
      sizeBytes: s.sizeBytes,
      busy: s.busy,
      worktree: s.worktree,
      usage: s.usage
        ? {
            prompt: s.usage.prompt ?? 0,
            completion: s.usage.completion ?? 0,
            total: s.usage.total ?? 0,
          }
        : undefined,
    }))
    state.sessionList = mapped
  } catch {
    state.sessionList = state.session ? [state.session] : []
  }
}

/** Keep this app run's project session; create fresh instead of auto-resuming disk history. */
export async function hydrateProjectSession(): Promise<void> {
  const project = state.activeProject
  if (!project) return

  if (state.session) {
    await refreshSessionList()
    return
  }

  if (hydrateInFlight) return hydrateInFlight
  hydrateInFlight = (async () => {
    try {
      await newSession()
      const fresh = state.session as { id: string } | null
      if (fresh) state.pushLog(`[session] fresh app session ${fresh.id.slice(0, 8)}…`)
    } catch (err) {
      state.pushLog(
        `[session] hydrate failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      hydrateInFlight = null
    }
  })()
  return hydrateInFlight
}

export async function ensureSession(): Promise<string | null> {
  const project = state.activeProject
  if (!project) return null

  const existing = state.session as { id: string } | null
  if (existing) return existing.id

  await hydrateProjectSession()
  const s = state.session as { id: string } | null
  return s?.id ?? null
}

export async function stopAgentTurn(): Promise<void> {
  if (!state.session) return
  const sessionId = state.session.id
  await window.enpiistudio.enpii.request('session.stop', { sessionId })
  state.setSessionBusy(sessionId, false)
  state.clearApproval()
  state.streamingId = null
  state.updateRun({ status: 'cancelled', lastEvent: 'stopped by user' })
  state.stashLiveSession(sessionId)
}

/** Toggle durable memory inject for active session. */
export async function setSessionLoadMemory(loadMemory: boolean): Promise<void> {
  const session = state.session
  if (!session) return
  const meta = (await window.enpiistudio.enpii.request('session.set_load_memory', {
    sessionId: session.id,
    loadMemory,
  })) as { loadMemory?: boolean }
  state.session = { ...session, loadMemory: meta.loadMemory !== false }
  state.pushLog(`[session] memory ${state.session.loadMemory ? 'on' : 'off'}`)
}

export type WorktreeListItem = {
  path: string
  head: string
  branch?: string
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
  main: boolean
}

export async function listProjectWorktrees(): Promise<WorktreeListItem[]> {
  const project = state.activeProject
  if (!project) return []
  return (await window.enpiistudio.enpii.request('git.worktree_list', {
    projectRoot: project.path,
  })) as WorktreeListItem[]
}

/** Remove a linked worktree path (force). Does not touch agent session files. */
export async function removeProjectWorktree(worktreePath: string): Promise<WorktreeListItem[]> {
  const project = state.activeProject
  if (!project) throw new Error('No project')
  const list = (await window.enpiistudio.enpii.request('git.worktree_remove', {
    projectRoot: project.path,
    path: worktreePath,
    force: true,
  })) as WorktreeListItem[]
  state.pushLog(`[worktree] removed ${worktreePath}`)
  state.notify('info', 'Worktree removed', worktreePath.split(/[\\/]/).slice(-1)[0] ?? worktreePath)
  return list
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Open existing worktree session or create one jailed to this tree (no new git worktree). */
export async function openWorktreeByPath(
  worktreePath: string,
  branch?: string,
): Promise<void> {
  const project = state.activeProject
  if (!project) return

  const want = normPath(worktreePath)
  const branchKey = branch?.replace(/^refs\/heads\//, '')
  const match = state.sessionList.find((s) => {
    if (s.projectRoot && normPath(s.projectRoot) === want) return true
    if (branchKey && s.worktreeBranch?.replace(/^refs\/heads\//, '') === branchKey) return true
    return false
  })
  if (match) {
    await openSession(match.id)
    return
  }

  state.stashLiveSession()
  try {
    const result = (await window.enpiistudio.enpii.request('session.worktree_open', {
      projectRoot: project.path,
      worktreePath,
      branch: branchKey,
    })) as {
      created: boolean
      session: {
        id: string
        title: string
        status: string
        model: string
        projectRoot?: string
        baseProjectRoot?: string
        worktreeBranch?: string
        loadMemory?: boolean
      }
      worktree: { path: string; branch?: string }
    }
    state.session = {
      id: result.session.id,
      title: result.session.title,
      status: result.session.status,
      model: result.session.model,
      projectRoot: result.session.projectRoot ?? result.worktree.path,
      baseProjectRoot: result.session.baseProjectRoot ?? project.path,
      worktreeBranch: result.session.worktreeBranch ?? result.worktree.branch,
      loadMemory: result.session.loadMemory,
    }
    if (state.restoreLiveSession(result.session.id)) {
      await refreshSessionList()
      return
    }
    // Prefer disk transcript if any
    try {
      const loaded = (await window.enpiistudio.enpii.request('session.get', {
        sessionId: result.session.id,
      })) as { messages?: { role: string; content: string; toolName?: string; summary?: string; preview?: string; ok?: boolean }[] }
      state.messages = mapDiskMessages(loaded.messages ?? [])
    } catch {
      state.messages = []
    }
    state.composer = ''
    state.attachments = []
    state.usage = null
    state.resetRun()
    state.streamingId = null
    state.clearApproval()
    state.approvals = []
    state.diffs = []
    state.checkpoints = []
    state.busy = false
    state.stashLiveSession(result.session.id)
    await refreshSessionList()
    state.pushLog(
      `[worktree] ${result.created ? 'attached' : 'opened'} ${result.worktree.branch ?? worktreePath}`,
    )
    state.notify(
      'info',
      result.created ? 'Worktree session' : 'Opened worktree',
      result.worktree.branch ?? worktreePath,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[worktree] open failed: ${message}`)
    state.notify('error', 'Open worktree failed', message)
  }
}

export async function renameSession(title: string, sessionId?: string): Promise<void> {
  const project = state.activeProject
  const id = sessionId ?? state.session?.id
  if (!project || !id) throw new Error('No session')
  const next = title.trim().slice(0, 120)
  if (!next) throw new Error('Title required')
  const meta = (await window.enpiistudio.enpii.request('session.upsert', {
    projectRoot: project.path,
    sessionId: id,
    title: next,
  })) as { id: string; title: string }
  if (state.session?.id === meta.id) {
    state.session = { ...state.session, title: meta.title }
  }
  state.sessionList = state.sessionList.map((s) =>
    s.id === meta.id ? { ...s, title: meta.title } : s,
  )
  state.pushLog(`[session] rename ${meta.id.slice(0, 8)}… → ${meta.title}`)
}

export async function newSession(): Promise<void> {
  const project = state.activeProject
  if (!project) return

  // Keep previous session running in background — do not stop it.
  state.stashLiveSession()

  const meta = (await window.enpiistudio.enpii.request('session.upsert', {
    projectRoot: project.path,
    title: `${project.name} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
    model: 'enpii',
    dialect: 'openai',
    fresh: true,
  })) as {
    id: string
    title: string
    status: string
    model: string
    projectRoot?: string
    baseProjectRoot?: string
    worktreeBranch?: string
  }

  state.session = {
    id: meta.id,
    title: meta.title,
    status: meta.status,
    model: meta.model,
    projectRoot: meta.projectRoot,
    baseProjectRoot: meta.baseProjectRoot,
    worktreeBranch: meta.worktreeBranch,
  }
  state.messages = []
  state.composer = ''
  state.attachments = []
  state.usage = null
  state.resetRun()
  state.streamingId = null
  state.clearApproval()
  state.approvals = []
  state.diffs = []
  state.checkpoints = []
  state.busy = false
  state.stashLiveSession(meta.id)
  await refreshSessionList()
  state.pushLog(`[session] new ${meta.id.slice(0, 8)}…`)
}

/** Isolated attempt: git worktree + fresh session jailed to it. */
export async function startWorktreeSession(name?: string): Promise<void> {
  const project = state.activeProject
  if (!project) return
  // Previous session may keep running in background.
  state.stashLiveSession()
  try {
    const result = (await window.enpiistudio.enpii.request('session.worktree_start', {
      projectRoot: project.path,
      name,
    })) as {
      session: {
        id: string
        title: string
        status: string
        model: string
        projectRoot?: string
        baseProjectRoot?: string
        worktreeBranch?: string
      }
      worktree: { path: string; branch?: string }
    }
    state.session = {
      id: result.session.id,
      title: result.session.title,
      status: result.session.status,
      model: result.session.model,
      projectRoot: result.session.projectRoot ?? result.worktree.path,
      baseProjectRoot: result.session.baseProjectRoot ?? project.path,
      worktreeBranch: result.session.worktreeBranch ?? result.worktree.branch,
    }
    state.messages = []
    state.composer = ''
    state.attachments = []
    state.usage = null
    state.resetRun()
    state.streamingId = null
    state.clearApproval()
    state.approvals = []
    state.diffs = []
    state.checkpoints = []
    state.busy = false
    state.stashLiveSession(result.session.id)
    await refreshSessionList()
    state.pushLog(
      `[worktree] ${result.worktree.branch ?? 'branch'} @ ${result.worktree.path}`,
    )
    state.notify(
      'info',
      'Worktree session',
      result.worktree.branch
        ? `Jailed to ${result.worktree.branch}`
        : `Jailed to ${result.worktree.path}`,
    )
    // Inspector list refreshes via project path effect on next tick.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[worktree] start failed: ${message}`)
    state.notify('error', 'Worktree failed', message)
  }
}

export async function listAgentBoard(): Promise<{
  count: number
  busy: number
  agents: {
    id: string
    title: string
    status: string
    busy: boolean
    worktreeBranch?: string
    projectRoot?: string
    model?: string
  }[]
}> {
  const project = state.activeProject
  if (!project) return { count: 0, busy: 0, agents: [] }
  return (await window.enpiistudio.enpii.request('session.agents', {
    projectRoot: project.path,
  })) as {
    count: number
    busy: number
    agents: {
      id: string
      title: string
      status: string
      busy: boolean
      worktreeBranch?: string
      projectRoot?: string
      model?: string
    }[]
  }
}

/** Fan-out one prompt to worktree agent sessions (max 4). */
export async function promptManyAgents(text: string, sessionIds?: string[]): Promise<void> {
  const project = state.activeProject
  if (!project || !text.trim()) return
  try {
    const result = (await window.enpiistudio.enpii.request('session.prompt_many', {
      projectRoot: project.path,
      text: text.trim(),
      sessionIds,
    })) as { ok: boolean; results: { sessionId: string; ok: boolean; error?: string }[] }
    const okN = result.results?.filter((r) => r.ok).length ?? 0
    const failN = (result.results?.length ?? 0) - okN
    state.pushLog(`[agents] fan-out ok=${okN} fail=${failN}`)
    state.notify(
      failN && !okN ? 'error' : 'info',
      'Multi-agent prompt',
      failN ? `${okN} ok, ${failN} failed` : `${okN} agent(s) running/done`,
    )
    await refreshSessionList()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[agents] fan-out failed: ${message}`)
    state.notify('error', 'Multi-agent prompt failed', message)
  }
}

/** Spawn N isolated worktree agent sessions (ClawTeam-style). Focuses the last created. */
export async function startWorktreeAgents(count = 2, prefix = 'agent'): Promise<void> {
  const project = state.activeProject
  if (!project) return
  state.stashLiveSession()
  try {
    const result = (await window.enpiistudio.enpii.request('session.worktree_start_many', {
      projectRoot: project.path,
      count,
      prefix,
    })) as {
      ok: boolean
      created: {
        session: {
          id: string
          title: string
          status: string
          model: string
          projectRoot?: string
          baseProjectRoot?: string
          worktreeBranch?: string
        }
        worktree: { path: string; branch?: string }
      }[]
      errors: string[]
    }
    if (!result.created?.length) {
      throw new Error(result.errors?.join('; ') || 'no worktrees created')
    }
    const last = result.created[result.created.length - 1]!
    state.session = {
      id: last.session.id,
      title: last.session.title,
      status: last.session.status,
      model: last.session.model,
      projectRoot: last.session.projectRoot ?? last.worktree.path,
      baseProjectRoot: last.session.baseProjectRoot ?? project.path,
      worktreeBranch: last.session.worktreeBranch ?? last.worktree.branch,
    }
    state.messages = []
    state.composer = ''
    state.attachments = []
    state.usage = null
    state.resetRun()
    state.streamingId = null
    state.clearApproval()
    state.approvals = []
    state.diffs = []
    state.checkpoints = []
    state.busy = false
    state.stashLiveSession(last.session.id)
    await refreshSessionList()
    for (const item of result.created) {
      state.pushLog(`[worktree+] ${item.worktree.branch ?? '?'} @ ${item.worktree.path}`)
    }
    if (result.errors?.length) {
      state.pushLog(`[worktree+] partial errors: ${result.errors.join('; ')}`)
    }
    state.notify('info', 'Multi-agent worktrees', `Created ${result.created.length} isolated session(s)`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[worktree+] start failed: ${message}`)
    state.notify('error', 'Multi-agent failed', message)
  }
}

export type WorktreePreview = {
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

export async function previewWorktreeSession(sessionId?: string): Promise<WorktreePreview | null> {
  const id = sessionId ?? state.session?.id
  if (!id) return null
  return (await window.enpiistudio.enpii.request('session.worktree_preview', {
    sessionId: id,
  })) as WorktreePreview
}

export async function applyWorktreeSession(opts: {
  remove?: boolean
  keepBranch?: boolean
} = {}): Promise<{ conflicts?: WorktreeConflict[] } | void> {
  const session = state.session
  if (!session?.baseProjectRoot) {
    state.notify(
      'error',
      'Apply failed',
      session?.worktreeBranch
        ? 'Session missing base project — open the Worktree session from the list (not a normal chat)'
        : 'Switch to a worktree session first (WT tag)',
    )
    return
  }
  if (state.busy) {
    state.notify('error', 'Apply failed', 'Stop the agent first')
    return
  }
  try {
    const result = (await window.enpiistudio.enpii.request('session.worktree_apply', {
      sessionId: session.id,
      remove: opts.remove !== false,
      keepBranch: Boolean(opts.keepBranch),
    })) as {
      merged: string
      removed: boolean
      ok?: boolean
      conflicts?: WorktreeConflict[]
      keptBranch?: string
    }
    if (result.conflicts?.length) {
      state.pushLog(`[worktree] merge conflicts: ${result.conflicts.map((c) => c.path).join(', ')}`)
      state.notify('warning', 'Merge conflicts', `${result.conflicts.length} file(s) need resolve in main`)
      return { conflicts: result.conflicts }
    }
    const keepNote = result.keptBranch ? ` · kept ${result.keptBranch}` : ''
    state.pushLog(`[worktree] applied ${result.merged}${result.removed ? ' · removed' : ''}${keepNote}`)
    state.notify('success', 'Worktree applied', `Merged ${result.merged} into main${keepNote}`)
    await newSession()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[worktree] apply failed: ${message}`)
    state.notify('error', 'Apply failed', message)
  }
}

export async function discardWorktreeSession(opts: { confirmed?: boolean } = {}): Promise<void> {
  const session = state.session
  if (!session?.baseProjectRoot) {
    state.notify(
      'error',
      'Discard failed',
      session?.worktreeBranch
        ? 'Session missing base project — open the Worktree session from the list (not a normal chat)'
        : 'Switch to a worktree session first (WT tag)',
    )
    return
  }
  if (!opts.confirmed) return
  try {
    if (state.busy || state.pendingApprovals.length > 0) {
      await window.enpiistudio.enpii.request('session.stop', { sessionId: session.id })
      state.busy = false
      state.clearApproval()
      state.streamingId = null
    }
    const result = (await window.enpiistudio.enpii.request('session.worktree_discard', {
      sessionId: session.id,
    })) as { deletedBranch?: string; alreadyGone?: boolean }
    const note = result.alreadyGone
      ? 'Orphan chat archived (tree was already gone)'
      : result.deletedBranch
        ? `Removed · deleted ${result.deletedBranch}`
        : 'Removed isolated tree'
    state.pushLog(`[worktree] discarded${result.alreadyGone ? ' · orphan' : ''}${result.deletedBranch ? ` · ${result.deletedBranch}` : ''}`)
    state.notify('info', 'Worktree discarded', note)
    await newSession()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pushLog(`[worktree] discard failed: ${message}`)
    state.notify('error', 'Discard failed', message)
  }
}

export async function openSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  if (state.session?.id === sessionId) return

  // Always stash active live state (may still be streaming).
  state.stashLiveSession()

  try {
    state.pushLog(`[session] open ${sessionId.slice(0, 8)}…`)

    // Prefer in-memory live runtime (background concurrent run).
    // Meta identity comes from session list / disk only — never previous session.
    if (state.restoreLiveSession(sessionId)) {
      const live = state.getLive(sessionId)
      let listed = state.sessionList.find((s) => s.id === sessionId)
      if (!listed) {
        try {
          const loaded = (await window.enpiistudio.enpii.request('session.get', {
            sessionId,
          })) as {
            meta: {
              id: string
              title: string
              status: string
              model: string
              projectRoot?: string
              baseProjectRoot?: string
              worktreeBranch?: string
              loadMemory?: boolean
              usage?: { prompt?: number; completion?: number; total?: number }
            }
          }
          listed = {
            id: loaded.meta.id,
            title: loaded.meta.title,
            status: loaded.meta.status,
            model: loaded.meta.model,
            projectRoot: loaded.meta.projectRoot,
            baseProjectRoot: loaded.meta.baseProjectRoot,
            worktreeBranch: loaded.meta.worktreeBranch,
            usage: loaded.meta.usage
              ? {
                  prompt: loaded.meta.usage.prompt ?? 0,
                  completion: loaded.meta.usage.completion ?? 0,
                  total: loaded.meta.usage.total ?? 0,
                }
              : undefined,
          }
        } catch {
          /* fall through with sparse meta */
        }
      }
      state.session = {
        id: sessionId,
        title: listed?.title ?? 'Session',
        status: live.status || listed?.status || (live.busy ? 'running' : 'idle'),
        model: listed?.model ?? state.provider?.model ?? 'enpii',
        projectRoot: listed?.projectRoot,
        baseProjectRoot: listed?.baseProjectRoot,
        worktreeBranch: listed?.worktreeBranch,
        loadMemory: listed ? (listed as { loadMemory?: boolean }).loadMemory : undefined,
        usage: listed?.usage,
      }
      state.pushLog(`[session] restored live msgs=${state.messages.length} busy=${state.busy}`)
      await refreshSessionList()
      return
    }

    const loaded = (await window.enpiistudio.enpii.request('session.get', {
      sessionId,
    })) as {
      meta: {
        id: string
        title: string
        status: string
        model: string
        projectRoot?: string
        baseProjectRoot?: string
        worktreeBranch?: string
        loadMemory?: boolean
        usage?: { prompt?: number; completion?: number; total?: number }
      }
      messages: { role: string; content: string; toolName?: string }[]
    }
    const diskUsage = loaded.meta.usage
    const usage = diskUsage
      ? {
          prompt: diskUsage.prompt ?? 0,
          completion: diskUsage.completion ?? 0,
          total: diskUsage.total ?? 0,
        }
      : null
    state.session = {
      id: loaded.meta.id,
      title: loaded.meta.title,
      status: loaded.meta.status,
      model: loaded.meta.model,
      projectRoot: loaded.meta.projectRoot,
      baseProjectRoot: loaded.meta.baseProjectRoot,
      worktreeBranch: loaded.meta.worktreeBranch,
      loadMemory: loaded.meta.loadMemory,
      usage: usage ?? undefined,
    }
    state.messages = mapDiskMessages(loaded.messages ?? [])
    state.composer = ''
    state.attachments = []
    state.streamingId = null
    state.usage = usage
    state.resetRun()
    state.clearApproval()
    state.approvals = []
    state.diffs = []
    state.busy = loaded.meta.status === 'running' || loaded.meta.status === 'awaiting_approval'
    state.stashLiveSession(sessionId)
    state.pushLog(`[session] loaded msgs=${state.messages.length}${state.usage ? ` · Σ${state.usage.total}` : ''}`)
    await refreshSessionList()
  } catch (err) {
    state.pushLog(
      `[session] open failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export async function sendPrompt(
  text: string,
  options?: {
    displayText?: string
    images?: { name: string; mime: string; dataUrl: string }[]
    attachments?: { name: string; kind?: 'text' | 'image' }[]
  },
): Promise<void> {
  const sessionId = await ensureSession()
  if (!sessionId) throw new Error('Open a project first')

  state.pushMessage({
    role: 'user',
    text: options?.displayText ?? text,
    attachments: options?.attachments,
  })
  state.setSessionBusy(sessionId, true)
  state.resetRun()
  state.streamingId = null
  state.stashLiveSession(sessionId)
  try {
    await window.enpiistudio.enpii.request('session.prompt', {
      sessionId,
      text,
      images: options?.images,
    })
    await refreshSessionList()
  } finally {
    // Only clear busy if still this session (user may have switched away).
    state.setSessionBusy(sessionId, false)
    if (state.session?.id === sessionId) {
      state.streamingId = null
    } else {
      const live = state.getLive(sessionId)
      live.busy = false
      live.streamingId = null
      state.patchLive(sessionId, { busy: false, streamingId: null, status: 'idle' })
    }
    state.stashLiveSession(sessionId)
  }
}

export async function compactSession(): Promise<{
  summary: string
  originalMessageCount: number
  canUndo?: boolean
}> {
  const sessionId = state.session?.id
  if (!sessionId) throw new Error('Open a session first')
  if (state.isSessionBusy(sessionId)) throw new Error('Session sedang sibuk')
  state.setSessionBusy(sessionId, true)
  try {
    const result = (await window.enpiistudio.enpii.request('session.compact', { sessionId })) as {
      summary: string
      originalMessageCount: number
      canUndo?: boolean
    }
    if (state.session?.id === sessionId) {
      state.messages = []
      state.pushMessage({
        role: 'system',
        text: `Context compacted (${result.originalMessageCount} messages). Undo: /undo-compact\n\n${result.summary}`,
      })
      state.resetRun()
      state.stashLiveSession(sessionId)
    }
    await refreshSessionList()
    return result
  } finally {
    state.setSessionBusy(sessionId, false)
    state.stashLiveSession(sessionId)
  }
}

export async function undoCompactSession(): Promise<{ messageCount: number }> {
  const sessionId = state.session?.id
  if (!sessionId) throw new Error('Open a session first')
  if (state.isSessionBusy(sessionId)) throw new Error('Session sedang sibuk')
  state.setSessionBusy(sessionId, true)
  try {
    const result = (await window.enpiistudio.enpii.request('session.compact_undo', {
      sessionId,
    })) as {
      messageCount: number
      messages?: {
        role: string
        content: string
        toolName?: string
        summary?: string
        preview?: string
        ok?: boolean
      }[]
    }
    if (state.session?.id === sessionId) {
      state.messages = mapDiskMessages(result.messages ?? [])
      state.pushMessage({
        role: 'system',
        text: `Compact undone · restored ${result.messageCount} messages`,
      })
      state.resetRun()
      state.stashLiveSession(sessionId)
    }
    await refreshSessionList()
    return { messageCount: result.messageCount }
  } finally {
    state.setSessionBusy(sessionId, false)
    state.stashLiveSession(sessionId)
  }
}

export async function exportSessionMarkdown(): Promise<{ markdown: string; title: string; messageCount: number }> {
  const sessionId = state.session?.id
  if (!sessionId) throw new Error('Open a session first')
  const result = (await window.enpiistudio.enpii.request('session.export', { sessionId })) as {
    markdown: string
    title: string
    messageCount: number
  }
  const safe = (result.title || 'session').replace(/[^\w.-]+/g, '_').slice(0, 60)
  const saved = await window.enpiistudio.dialog.saveTextFile({
    defaultPath: `${safe}-${sessionId.slice(0, 8)}.md`,
    content: result.markdown,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (saved) {
    state.pushLog(`[session] exported ${saved}`)
    state.notify('success', 'Transcript exported', saved)
  }
  return result
}

export function bindEnpiiEvents(): () => void {
  const api = window.enpiistudio
  if (!api?.enpii) {
    state.enpiiStatus = 'error'
    state.enpiiInfo = 'preload missing (window.enpiistudio undefined)'
    state.pushLog('[preload] window.enpiistudio undefined — check dist-electron/preload.cjs')
    return () => {}
  }

  const offEvent = api.enpii.onEvent((payload) => {
    const msg = payload as {
      method?: string
      params?: {
        type?: string
        sessionId?: string
        status?: string
        text?: string
        message?: { role?: string; content?: string }
        detail?: string
        partial?: boolean
        toolCallId?: string
        requestId?: string
        name?: string
        args?: string
        path?: string
        ok?: boolean
        summary?: string
        preview?: string
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
        run?: Record<string, unknown>
        command?: string
        output?: string
        failures?: string[]
        passed?: boolean
        fingerprint?: string
        hasAgentInstructions?: boolean
        hasMemory?: boolean
        skillCount?: number
        loadedSkills?: string[]
        tasks?: { id: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed'; detail?: string; startedAt?: string; finishedAt?: string; toolCount?: number }[]
        attempt?: number
        state?: 'open' | 'half_open' | 'closed'
        checkpointId?: string
        prompt?: string
        files?: AgentCheckpoint['files']
      }
    }
    const p = msg.params
    if (!p) return

    const eventSessionId = p.sessionId ?? state.session?.id
    if (!eventSessionId) return
    const active = state.session?.id === eventSessionId

    const applyBackground = (mutator: (live: ReturnType<typeof state.getLive>) => void) => {
      state.mutateLive(eventSessionId, mutator)
    }

    if (p.type === 'project_context' && p.fingerprint) {
      if (!active) return
      state.updateRun({
        context: {
          fingerprint: p.fingerprint,
          hasAgentInstructions: Boolean(p.hasAgentInstructions),
          hasMemory: Boolean(p.hasMemory),
          skillCount: p.skillCount ?? 0,
          loadedSkills: p.loadedSkills ?? [],
        },
      })
      state.stashLiveSession(eventSessionId)
      return
    }

    if (p.type === 'run_state' && p.run) {
      if (active) {
        state.updateRun({ run: p.run })
        state.stashLiveSession(eventSessionId)
      } else {
        const status = String((p.run as { status?: string }).status ?? 'running')
        applyBackground((live) => {
          live.status = status
          live.busy = status === 'running' || status === 'awaiting_approval' || status === 'verifying' || status === 'repairing'
        })
      }
      return
    }

    if (p.type === 'task_plan' && p.tasks) {
      if (active) {
        state.updateRun({ tasks: p.tasks })
        state.stashLiveSession(eventSessionId)
      }
      return
    }

    if (p.type === 'verification_check' && p.command) {
      if (active) state.addRunCheck({ command: p.command, ok: p.ok !== false, output: p.output ?? '' })
      return
    }

    if (p.type === 'verification_start') {
      if (active) state.updateRun({ status: 'verifying', lastEvent: 'verification started' })
      return
    }

    if (p.type === 'verification_result') {
      if (active) {
        state.updateRun({
          verifier: {
            passed: p.passed === true,
            summary: p.summary ?? 'Verification completed',
            failures: p.failures ?? [],
          },
        })
      }
      return
    }

    if (p.type === 'provider_retry') {
      if (active) state.updateRun({ retries: (state.run?.retries ?? 0) + 1, lastEvent: `provider retry ${p.attempt ?? '?'}` })
      return
    }

    if (p.type === 'provider_circuit' && p.state) {
      if (active) state.updateRun({ circuit: p.state, lastEvent: `provider circuit ${p.state}` })
      return
    }

    if (p.type === 'text_delta' && p.text) {
      if (active) {
        if (state.streamingId) {
          state.appendToMessage(state.streamingId, p.text)
        } else {
          const m = state.pushMessage({ role: 'assistant', text: p.text })
          state.streamingId = m.id
        }
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.busy = true
          if (live.streamingId) {
            live.messages = live.messages.map((m) =>
              m.id === live.streamingId ? { ...m, text: m.text + p.text! } : m,
            )
          } else {
            const id = crypto.randomUUID()
            live.streamingId = id
            live.messages = [
              ...live.messages,
              { id, role: 'assistant', text: p.text!, ts: Date.now() },
            ]
          }
        })
      }
      return
    }

    if (p.type === 'tool_start' && p.toolCallId && p.name) {
      if (active) {
        state.streamingId = null
        state.updateRun({ toolCount: (state.run?.toolCount ?? 0) + 1, lastEvent: `tool started: ${p.name}` })
        state.pushMessage({
          role: 'tool',
          text: p.summary ?? p.name,
          tool: {
            callId: p.toolCallId,
            name: p.name,
            args: p.args,
            path: toolPath(p.args),
            status: 'running',
            summary: p.summary ?? `${p.name} ${p.args ?? ''}`.trim(),
          },
        })
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.busy = true
          live.streamingId = null
          live.messages = [
            ...live.messages,
            {
              id: crypto.randomUUID(),
              role: 'tool',
              text: p.summary ?? p.name!,
              ts: Date.now(),
              tool: {
                callId: p.toolCallId!,
                name: p.name!,
                args: p.args,
                path: toolPath(p.args),
                status: 'running',
                summary: p.summary ?? `${p.name} ${p.args ?? ''}`.trim(),
              },
            },
          ]
        })
      }
      return
    }

    if (p.type === 'approval_request' && p.requestId && p.name) {
      const approval = {
        requestId: p.requestId,
        sessionId: eventSessionId,
        toolCallId: p.toolCallId ?? p.requestId,
        name: p.name,
        summary: p.summary ?? p.name,
        preview: p.preview ?? '',
        args: p.args,
      }
      if (active) {
        state.enqueueApproval(approval)
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.pendingApprovals = [approval, ...live.pendingApprovals.filter((a) => a.requestId !== approval.requestId)]
          live.busy = true
          live.status = 'awaiting_approval'
        })
      }
      const title = active
        ? (state.pendingApprovals.length > 1 ? `Approval required (${state.pendingApprovals.length})` : 'Approval required')
        : 'Approval (background session)'
      state.notify('warning', title, p.summary ?? p.name)
      void window.enpiistudio.app.showNotification?.({
        title,
        body: p.summary ?? p.name,
        urgency: 'critical',
      })
      return
    }

    if (p.type === 'ask_user_request' && p.requestId && p.question) {
      const ask = {
        requestId: String(p.requestId),
        sessionId: eventSessionId,
        toolCallId: String(p.toolCallId ?? p.requestId),
        question: String(p.question),
        options: Array.isArray(p.options) ? p.options.map(String) : undefined,
        summary: String(p.summary ?? p.question),
      }
      if (active) {
        state.enqueueAsk(ask)
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.pendingAsks = [ask, ...(live.pendingAsks ?? []).filter((a) => a.requestId !== ask.requestId)]
          live.busy = true
          live.status = 'awaiting_approval'
        })
      }
      state.notify('warning', 'enpii asks', ask.summary)
      void window.enpiistudio.app.showNotification?.({
        title: 'enpii asks',
        body: ask.summary,
        urgency: 'critical',
      })
      return
    }

    if (p.type === 'plan_mode') {
      const activePlan = p.active === true
      if (active) {
        state.planMode = activePlan
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.planMode = activePlan
        })
      }
      return
    }

    if (p.type === 'tool_result' && p.toolCallId) {
      if (active) {
        state.updateTool(p.toolCallId, {
          status: p.ok === false ? 'error' : 'ok',
          summary: p.summary,
          preview: p.preview,
          text: p.summary ?? p.name ?? 'tool',
        })
        state.updateRun({ lastEvent: p.ok === false ? `tool failed: ${p.name ?? 'tool'}` : `tool completed: ${p.name ?? 'tool'}` })
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.messages = live.messages.map((m) => {
            if (m.role !== 'tool' || m.tool?.callId !== p.toolCallId) return m
            return {
              ...m,
              text: p.summary ?? p.name ?? m.text,
              tool: {
                ...m.tool!,
                status: p.ok === false ? 'error' : 'ok',
                summary: p.summary,
                preview: p.preview,
              },
            }
          })
        })
      }
      return
    }

    if (p.type === 'diff' && p.summary) {
      if (active) {
        state.pushDiff({
          name: p.name ?? 'write',
          path: p.path ?? toolPath(p.args),
          summary: p.summary,
          preview: p.preview ?? '',
        })
        state.stashLiveSession(eventSessionId)
      }
      return
    }

    if (p.type === 'checkpoint' && p.checkpointId) {
      const checkpoint = {
        id: p.checkpointId,
        createdAt: new Date().toISOString(),
        prompt: p.prompt,
        files: Array.isArray(p.files) ? p.files as AgentCheckpoint['files'] : [],
      }
      if (active) {
        state.checkpoints = [checkpoint, ...state.checkpoints.filter((item) => item.id !== checkpoint.id)]
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.checkpoints = [checkpoint, ...live.checkpoints.filter((item) => item.id !== checkpoint.id)]
        })
      }
      return
    }

    if (p.type === 'assistant_message' && p.message?.content) {
      const content =
        typeof p.message.content === 'string'
          ? p.message.content
          : JSON.stringify(p.message.content)
      if (active) {
        const id =
          state.streamingId ??
          [...state.messages].reverse().find((m) => m.role === 'assistant')?.id
        if (id) {
          state.messages = state.messages.map((m) =>
            m.id === id ? { ...m, text: content } : m,
          )
          state.streamingId = null
        } else {
          state.pushMessage({ role: 'assistant', text: content })
        }
        // Usage accumulates only on dedicated `usage` event (once per turn) — avoid double-count with assistant_message.
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          const id =
            live.streamingId ??
            [...live.messages].reverse().find((m) => m.role === 'assistant')?.id
          if (id) {
            live.messages = live.messages.map((m) => (m.id === id ? { ...m, text: content } : m))
            live.streamingId = null
          } else {
            live.messages = [
              ...live.messages,
              { id: crypto.randomUUID(), role: 'assistant', text: content, ts: Date.now() },
            ]
          }
        })
      }
    }

    // Turn usage: accumulate for live UI. session_usage (below) replaces with disk totals after prompt.
    if (p.type === 'usage' && p.usage) {
      const applyUsage = (live: { usage: { prompt: number; completion: number; total: number } | null }) => {
        const next = {
          prompt: p.usage!.prompt_tokens ?? 0,
          completion: p.usage!.completion_tokens ?? 0,
          total: p.usage!.total_tokens ?? (p.usage!.prompt_tokens ?? 0) + (p.usage!.completion_tokens ?? 0),
        }
        live.usage = live.usage
          ? {
              prompt: live.usage.prompt + next.prompt,
              completion: live.usage.completion + next.completion,
              total: live.usage.total + next.total,
            }
          : next
      }
      if (active) {
        state.setUsage(p.usage, 'add')
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => applyUsage(live))
      }
    }

    // Authoritative session totals from disk (after addUsage in core).
    if (p.type === 'session_usage' && p.usage) {
      const totals = {
        prompt: p.usage.prompt_tokens ?? 0,
        completion: p.usage.completion_tokens ?? 0,
        total: p.usage.total_tokens ?? (p.usage.prompt_tokens ?? 0) + (p.usage.completion_tokens ?? 0),
      }
      if (active) {
        state.setUsage(
          {
            prompt_tokens: totals.prompt,
            completion_tokens: totals.completion,
            total_tokens: totals.total,
          },
          'replace',
        )
        if (state.session) state.session = { ...state.session, usage: totals }
        state.sessionList = state.sessionList.map((s) =>
          s.id === eventSessionId ? { ...s, usage: totals } : s,
        )
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.usage = totals
        })
        state.sessionList = state.sessionList.map((s) =>
          s.id === eventSessionId ? { ...s, usage: totals } : s,
        )
      }
    }

    if (p.type === 'session_compacted') {
      const count = Number((p as { originalMessageCount?: number }).originalMessageCount ?? 0)
      const auto = Boolean((p as { auto?: boolean }).auto)
      const canUndo = Boolean((p as { canUndo?: boolean }).canUndo)
      const summary = String((p as { summary?: string }).summary ?? '').slice(0, 280)
      const undoHint = canUndo ? ' · Undo: /undo-compact' : ''
      const note = auto
        ? `Auto-compacted ${count} messages${summary ? ` · ${summary}` : ''}${undoHint}`
        : `Compacted ${count} messages${undoHint}`
      if (active) {
        state.pushMessage({ role: 'system', text: note })
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.messages = [
            ...live.messages,
            { id: crypto.randomUUID(), role: 'system', text: note, ts: Date.now() },
          ]
        })
      }
    }

    if (p.type === 'session_compact_undone' && !active) {
      const count = Number((p as { messageCount?: number }).messageCount ?? 0)
      applyBackground((live) => {
        live.messages = [
          ...live.messages,
          {
            id: crypto.randomUUID(),
            role: 'system',
            text: `Compact undone · restored ${count} messages`,
            ts: Date.now(),
          },
        ]
      })
    }

    if (p.type === 'error' && (p as { message?: string }).message) {
      const message = String((p as { message?: string }).message)
      if (active) {
        state.pushMessage({ role: 'system', text: message })
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.messages = [
            ...live.messages,
            { id: crypto.randomUUID(), role: 'system', text: message, ts: Date.now() },
          ]
          live.busy = false
          live.status = 'error'
        })
      }
      state.notify('error', active ? 'Agent failed' : 'Background agent failed', message)
    }

    if (p.type === 'status' && p.sessionId) {
      const status = p.status ?? 'idle'
      const terminal = status === 'idle' || status === 'error' || status === 'completed' || status === 'cancelled'
      if (active && state.session) {
        const previousStatus = state.session.status
        state.session = { ...state.session, status }
        state.updateRun({ status: status ?? state.run?.status ?? 'running' })
        if (terminal) state.setSessionBusy(eventSessionId, false)
        if (status === 'completed' && previousStatus !== 'completed') {
          state.notify('success', 'Agent completed', state.session.title)
        }
        state.stashLiveSession(eventSessionId)
      } else {
        applyBackground((live) => {
          live.status = status
          if (terminal) live.busy = false
          else if (status === 'running' || status === 'awaiting_approval') live.busy = true
        })
        if (status === 'completed') {
          const title = state.sessionList.find((s) => s.id === eventSessionId)?.title ?? 'Session'
          state.notify('success', 'Background agent done', title)
        }
      }
      void refreshSessionList()
    }
  })

  const offLog = api.enpii.onLog((line) => {
    state.pushLog(String(line).trimEnd())
  })

  const offExit = api.enpii.onExit((info) => {
    state.enpiiStatus = 'error'
    state.enpiiInfo = `exited ${JSON.stringify(info)}`
    state.pushLog(`[exit] ${JSON.stringify(info)}`)
    state.notify('error', 'enpii stopped', state.enpiiInfo)
  })

  return () => {
    offEvent()
    offLog()
    offExit()
  }
}
