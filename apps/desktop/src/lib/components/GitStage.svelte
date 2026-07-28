<script lang="ts">
  import { untrack } from 'svelte'
  import { state as app } from '../store.svelte'
  import {
    commitGitFiles,
    createGitBranch,
    deleteGitBranch,
    discardGitFile,
    getGitBranches,
    getGitDiff,
    getGitCommitDiff,
    getGitCommitFiles,
    getGitConflict,
    getGitHistory,
    getGitRemotes,
    fetchGit,
    pullGit,
    pushGit,
    getGitStatus,
    readProjectFile,
    resolveGitConflict,
    renameGitBranch,
    stageAllGitFiles,
    stageGitFile,
    stashAndSwitchGitBranch,
    suggestGitCommit,
    switchGitBranch,
    unstageAllGitFiles,
    unstageGitFile,
    type GitFileStatus,
    type GitCommit,
    type GitCommitFile,
    type GitConflict,
    type GitBranch,
    type GitRemote,
    type GitStatus,
  } from '../enpii'
  import { ConfirmDialog } from './ui'

  let status = $state<GitStatus | null>(null)
  let selectedPath = $state<string | null>(null)
  let diff = $state('')
  let loading = $state(false)
  let busy = $state(false)
  let error = $state('')
  let commitMessage = $state('')
  let discardTarget = $state<GitFileStatus | null>(null)
  let history = $state<GitCommit[]>([])
  let selectedCommit = $state<GitCommit | null>(null)
  let selectedCommitPath = $state<string | null>(null)
  let conflictDetail = $state<GitConflict | null>(null)
  let resolveTarget = $state<{ file: GitFileStatus; resolution: 'ours' | 'theirs' | 'mark' } | null>(null)
  let commitFiles = $state<Record<string, GitCommitFile[]>>({})
  let expandedCommits = $state<Record<string, boolean>>({})
  let collapsedFolders = $state<Record<string, boolean>>({})
  let branches = $state<GitBranch[]>([])
  let branchMenuOpen = $state(false)
  let branchSearch = $state('')
  let newBranchName = $state('')
  let renamingBranch = $state<string | null>(null)
  let renameBranchName = $state('')
  let deleteBranchTarget = $state<GitBranch | null>(null)
  let remotes = $state<GitRemote[]>([])
  let pendingBranchSwitch = $state<GitBranch | null>(null)
  let currentProjectId: string | null = null

  const selected = $derived(status?.files.find((file) => file.path === selectedPath) ?? null)
  const stagedFiles = $derived(status?.files.filter((file) => file.staged) ?? [])
  const changedFiles = $derived(status?.files.filter((file) => file.unstaged) ?? [])
  const filteredBranches = $derived(branches.filter((branch) => branch.name.toLowerCase().includes(branchSearch.trim().toLowerCase())))

  type TreeNode = { name: string; path: string; children: TreeNode[]; file?: GitCommitFile }
  type TreeRow = TreeNode & { depth: number }

  function treeRows(files: GitCommitFile[], commitHash: string): TreeRow[] {
    const root: TreeNode = { name: '', path: '', children: [] }
    for (const file of files) {
      let parent = root
      const parts = file.path.split('/')
      parts.forEach((name, index) => {
        const nodePath = parts.slice(0, index + 1).join('/')
        let node = parent.children.find((child) => child.name === name)
        if (!node) {
          node = { name, path: nodePath, children: [] }
          parent.children.push(node)
        }
        if (index === parts.length - 1) node.file = file
        parent = node
      })
    }
    const rows: TreeRow[] = []
    const flatten = (nodes: TreeNode[], depth: number) => {
      nodes
        .sort((left, right) => Number(Boolean(left.file)) - Number(Boolean(right.file)) || left.name.localeCompare(right.name))
        .forEach((node) => {
          rows.push({ ...node, depth })
          if (!node.file && !collapsedFolders[`${commitHash}:${node.path}`]) flatten(node.children, depth + 1)
        })
    }
    flatten(root.children, 0)
    return rows
  }

  function statusCode(file: GitFileStatus): string {
    if (file.conflicted) return 'C'
    if (file.untracked) return 'U'
    return `${file.index.trim()}${file.worktree.trim()}` || 'M'
  }

  function diffClass(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'text-studio-text-dim'
    if (line.startsWith('@@')) return 'bg-studio-link/12 text-studio-link'
    if (line.startsWith('+')) return 'bg-studio-success/20 text-studio-success-bright'
    if (line.startsWith('-')) return 'bg-studio-error/20 text-studio-error'
    return 'text-studio-text/75'
  }

  async function loadDiff(file: GitFileStatus): Promise<void> {
    const project = app.activeProject
    if (!project) return
    selectedPath = file.path
    selectedCommit = null
    selectedCommitPath = null
    conflictDetail = null
    error = ''
    try {
      if (file.untracked) {
        const content = (await readProjectFile(project.path, file.path)).content
        diff = [`--- /dev/null`, `+++ b/${file.path}`, '@@ new file @@', ...content.split('\n').map((line) => `+${line}`)].join('\n')
      } else {
        diff = await getGitDiff(project.path, file.path, file.staged && !file.unstaged)
      }
      if (file.conflicted) conflictDetail = await getGitConflict(project.path, file.path)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      diff = ''
    }
  }

  async function toggleCommit(commit: GitCommit): Promise<void> {
    const open = !expandedCommits[commit.hash]
    expandedCommits = { ...expandedCommits, [commit.hash]: open }
    if (!open) return
    if (commitFiles[commit.hash]) return
    const project = app.activeProject
    if (!project) return
    try {
      commitFiles = { ...commitFiles, [commit.hash]: await getGitCommitFiles(project.path, commit.hash) }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function loadCommitFile(commit: GitCommit, file: GitCommitFile): Promise<void> {
    const project = app.activeProject
    if (!project) return
    busy = true
    error = ''
    try {
      selectedCommit = commit
      selectedCommitPath = file.path
      selectedPath = null
      diff = await getGitCommitDiff(project.path, commit.hash, file.path)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      diff = ''
    } finally {
      busy = false
    }
  }

  function toggleFolder(commitHash: string, folderPath: string): void {
    const key = `${commitHash}:${folderPath}`
    collapsedFolders = { ...collapsedFolders, [key]: !collapsedFolders[key] }
  }

  async function branchMutation(action: () => Promise<{ branches: GitBranch[]; status: GitStatus }>, close = true): Promise<void> {
    busy = true
    error = ''
    try {
      const result = await action()
      branches = result.branches
      status = result.status
      history = await getGitHistory(app.activeProject!.path)
      selectedPath = null
      selectedCommit = null
      selectedCommitPath = null
      conflictDetail = null
      commitFiles = {}
      expandedCommits = {}
      diff = ''
      if (close) branchMenuOpen = false
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  function createBranch(): void {
    const name = newBranchName.trim()
    if (!name || !app.activeProject) return
    newBranchName = ''
    void branchMutation(() => createGitBranch(app.activeProject!.path, name))
  }

  function startRename(branch: GitBranch): void {
    renamingBranch = branch.name
    renameBranchName = branch.name
  }

  function renameBranch(branch: GitBranch): void {
    const name = renameBranchName.trim()
    if (!name || !app.activeProject) return
    renamingBranch = null
    void branchMutation(() => renameGitBranch(app.activeProject!.path, branch.name, name), false)
  }

  function requestBranchDelete(branch: GitBranch): void {
    branchMenuOpen = false
    deleteBranchTarget = branch
  }

  function requestBranchSwitch(branch: GitBranch): void {
    if (!app.activeProject || branch.current) return
    if ((status?.files.length ?? 0) > 0) {
      branchMenuOpen = false
      pendingBranchSwitch = branch
      return
    }
    void branchMutation(() => switchGitBranch(app.activeProject!.path, branch))
  }

  async function confirmBranchDelete(): Promise<void> {
    const branch = deleteBranchTarget
    const project = app.activeProject
    if (!branch || !project) return
    deleteBranchTarget = null
    busy = true
    error = ''
    try {
      branches = await deleteGitBranch(project.path, branch.name)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  function requestResolve(file: GitFileStatus, resolution: 'ours' | 'theirs' | 'mark'): void {
    resolveTarget = { file, resolution }
  }

  async function confirmResolve(): Promise<void> {
    const target = resolveTarget
    const project = app.activeProject
    if (!target || !project) return
    resolveTarget = null
    busy = true
    error = ''
    try {
      status = await resolveGitConflict(project.path, target.file.path, target.resolution)
      conflictDetail = null
      const next = status.files[0]
      if (next) await loadDiff(next)
      else {
        selectedPath = null
        diff = ''
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function confirmStashAndSwitch(): Promise<void> {
    const branch = pendingBranchSwitch
    const project = app.activeProject
    if (!branch || !project) return
    pendingBranchSwitch = null
    busy = true
    error = ''
    try {
      const result = await stashAndSwitchGitBranch(project.path, branch)
      branches = result.branches
      status = result.status
      history = await getGitHistory(project.path)
      selectedPath = null
      selectedCommit = null
      diff = ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function refresh(): Promise<void> {
    const project = app.activeProject
    if (!project) return
    loading = true
    error = ''
    try {
      status = await getGitStatus(project.path)
      branches = await getGitBranches(project.path)
      remotes = await getGitRemotes(project.path)
      history = await getGitHistory(project.path)
      const next = status.files.find((file) => file.path === selectedPath) ?? status.files[0]
      if (next) await loadDiff(next)
      else {
        selectedPath = null
        selectedCommit = null
        diff = ''
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      status = null
    } finally {
      loading = false
    }
  }

  async function mutate(action: () => Promise<GitStatus>): Promise<void> {
    busy = true
    error = ''
    try {
      status = await action()
      const next = status.files.find((file) => file.path === selectedPath) ?? status.files[0]
      if (next) await loadDiff(next)
      else {
        selectedPath = null
        diff = ''
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function commit(): Promise<void> {
    const project = app.activeProject
    if (!project || !commitMessage.trim()) return
    busy = true
    error = ''
    const message = commitMessage
    try {
      const result = await commitGitFiles(project.path, message)
      status = result.status
      history = await getGitHistory(project.path)
      commitMessage = ''
      selectedPath = status.files[0]?.path ?? null
      if (status.files[0]) await loadDiff(status.files[0])
      else diff = ''
      app.notify('success', 'Commit created', message)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      app.notify('error', 'Commit failed', error)
    } finally {
      busy = false
    }
  }

  async function autoCommitMessage(): Promise<void> {
    const project = app.activeProject
    if (!project || busy) return
    busy = true
    error = ''
    try {
      commitMessage = await suggestGitCommit(project.path)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  function requestDiscard(file: GitFileStatus): void {
    discardTarget = file
  }

  $effect(() => {
    const projectId = app.activeProjectId
    const mode = app.mode
    if (!projectId || mode !== 'git') return
    if (currentProjectId !== projectId) {
      currentProjectId = projectId
      selectedPath = null
      selectedCommit = null
      selectedCommitPath = null
      commitFiles = {}
      expandedCommits = {}
      collapsedFolders = {}
      branches = []
      branchMenuOpen = false
      branchSearch = ''
      remotes = []
    }
    untrack(() => void refresh())
  })

  async function syncRemote(action: 'fetch' | 'pull' | 'push'): Promise<void> {
    const project = app.activeProject
    if (!project || remotes.length === 0) return
    busy = true
    error = ''
    try {
      if (action === 'fetch') {
        const result = await fetchGit(project.path)
        remotes = result.remotes
        branches = result.branches
        status = result.status
      } else if (action === 'pull') {
        const result = await pullGit(project.path)
        status = result.status
        history = result.history
      } else {
        const hasUpstream = Boolean(status?.upstream)
        status = await pushGit(project.path, hasUpstream ? undefined : remotes[0]?.name, hasUpstream ? undefined : status?.branch, !hasUpstream)
      }
      app.notify('success', `Git ${action} completed`, status?.branch)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      app.notify('error', `Git ${action} failed`, error)
    } finally {
      busy = false
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col bg-transparent">
  {#if !app.activeProject}
    <div class="m-4 grid h-[calc(100%-32px)] place-items-center rounded-lg border border-dashed border-border-subtle text-studio-text-dim">
      <div class="text-center">
        <div class="mb-1.5 font-semibold text-white">Open a project</div>
        <div class="text-xs">Git mode needs a workspace.</div>
      </div>
    </div>
  {:else}
    <header class="flex min-h-10 items-center border-b border-border-subtle bg-studio-card/90 px-3">
      <button type="button" class="flex min-w-0 items-center gap-2 font-mono text-[11px] text-studio-text-dim hover:text-studio-text" aria-expanded={branchMenuOpen} onclick={() => (branchMenuOpen = !branchMenuOpen)}>
        <span class="size-1.5 rounded-lg bg-studio-gold"></span>
        <strong class="font-semibold text-studio-text">{status?.branch ?? 'Git'}</strong>
        {#if status?.upstream}<span>{status.upstream}</span>{/if}
        {#if status?.ahead}<span>↑{status.ahead}</span>{/if}
        {#if status?.behind}<span>↓{status.behind}</span>{/if}
        <span class="ml-0.5 text-white/35">⌄</span>
      </button>
    </header>
    {#if branchMenuOpen}
      <div class="fixed inset-0 z-[70]" role="presentation" onclick={() => (branchMenuOpen = false)}>
        <div class="absolute left-3 top-12 z-[71] w-80 rounded-lg border border-white/11 bg-studio-popover p-2 shadow-[0_18px_50px_rgba(0,0,0,0.5)]" role="dialog" aria-label="Branch manager" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape') branchMenuOpen = false }}>
          <input class="mb-1.5 w-full rounded-md border border-white/9 bg-black/25 px-2.5 py-1.5 text-xs text-studio-text outline-none focus:border-studio-purple-bright/80" bind:value={branchSearch} placeholder="Search branches" aria-label="Search branches" />
          <div class="mb-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
            <input class="w-full rounded-md border border-white/9 bg-black/25 px-2.5 py-1.5 text-xs text-studio-text outline-none focus:border-studio-purple-bright/80" bind:value={newBranchName} placeholder="New branch" aria-label="New branch name" onkeydown={(event) => event.key === 'Enter' && createBranch()} />
            <button type="button" class="rounded-md bg-studio-purple px-2.5 text-[10px] text-white disabled:opacity-45" disabled={busy || !newBranchName.trim()} onclick={createBranch}>Create</button>
          </div>
          <div class="max-h-80 overflow-auto">
            {#each filteredBranches as branch (branch.name)}
              <div class="grid min-h-[34px] grid-cols-[minmax(0,1fr)_25px_25px] items-center rounded-md px-1 {branch.current ? 'bg-white/[0.055]' : 'hover:bg-white/[0.055]'}">
                {#if renamingBranch === branch.name}
                  <input class="col-span-3 w-full rounded-md border border-white/9 bg-black/25 px-2 py-1 text-xs text-studio-text outline-none focus:border-studio-purple-bright/80" bind:value={renameBranchName} aria-label={`Rename ${branch.name}`} onkeydown={(event) => { if (event.key === 'Enter') renameBranch(branch); else if (event.key === 'Escape') renamingBranch = null }} />
                {:else}
                  <button type="button" class="grid min-w-0 grid-cols-[13px_minmax(0,1fr)] items-center gap-1.5 px-1 py-1 text-left text-[10px] text-studio-text-dim disabled:opacity-50" disabled={busy || branch.current} onclick={() => requestBranchSwitch(branch)}>
                    <span>{branch.current ? '●' : branch.remote ? '⇣' : '○'}</span>
                    <span class="flex min-w-0 flex-col">
                      <strong class="truncate font-medium text-studio-text">{branch.name}</strong>
                      {#if branch.upstream}<small class="truncate text-[9px] text-white/30">{branch.upstream}</small>{/if}
                    </span>
                  </button>
                  {#if !branch.remote}<button type="button" class="text-[11px] text-studio-text-dim hover:text-studio-text" title="Rename" aria-label={`Rename ${branch.name}`} onclick={() => startRename(branch)}>✎</button>{/if}
                  {#if !branch.remote && !branch.current}<button type="button" class="text-[11px] text-danger" title="Delete" aria-label={`Delete ${branch.name}`} onclick={() => requestBranchDelete(branch)}>×</button>{/if}
                {/if}
              </div>
            {/each}
            {#if filteredBranches.length === 0}<div class="px-2 py-3 text-center text-[11px] text-studio-text-dim">No matching branches.</div>{/if}
          </div>
        </div>
      </div>
    {/if}
    <div class="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col overflow-y-auto border-r border-border-subtle">
        <div class="flex flex-col gap-1.5 border-b border-border-subtle p-2.5">
          <textarea class="min-h-[72px] w-full resize-y rounded-md border border-border-subtle bg-studio-dark px-2.5 py-2 text-xs text-studio-text outline-none placeholder:text-studio-text-dim" rows="3" bind:value={commitMessage} placeholder="Commit message"></textarea>
          <div class="flex gap-1.5">
            <button type="button" class="rounded-lg border border-border-subtle px-2.5 py-1 text-[11px] text-studio-text-dim hover:bg-white/5 disabled:opacity-45" disabled={busy || stagedFiles.length === 0} onclick={() => void autoCommitMessage()}>Auto</button>
            <button type="button" class="flex-1 rounded-lg bg-studio-purple px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-45" disabled={busy || !commitMessage.trim() || stagedFiles.length === 0} onclick={() => void commit()}>Commit {stagedFiles.length ? `(${stagedFiles.length})` : ''}</button>
          </div>
          <div class="flex gap-1">
            <button type="button" class="flex-1 rounded-lg border border-border-subtle px-2 py-1 text-[10px] text-studio-text-dim hover:bg-white/5 disabled:opacity-45" disabled={busy || remotes.length === 0} onclick={() => void syncRemote('fetch')}>Fetch</button>
            <button type="button" class="flex-1 rounded-lg border border-border-subtle px-2 py-1 text-[10px] text-studio-text-dim hover:bg-white/5 disabled:opacity-45" disabled={busy || remotes.length === 0 || !status?.upstream || (status?.files.length ?? 0) > 0} onclick={() => void syncRemote('pull')}>Pull</button>
            <button type="button" class="flex-1 rounded-lg border border-border-subtle px-2 py-1 text-[10px] text-studio-text-dim hover:bg-white/5 disabled:opacity-45" disabled={busy || remotes.length === 0} onclick={() => void syncRemote('push')}>Push</button>
          </div>
        </div>
        <section class="border-b border-border-subtle p-2">
          <div class="mb-1 flex items-center justify-between text-[10px] text-studio-text-dim">
            <span class="font-bold uppercase tracking-widest">Staged Changes</span>
            <div class="flex items-center gap-1"><span>{stagedFiles.length}</span><button type="button" class="rounded px-1.5 py-0.5 hover:bg-white/5 disabled:opacity-45" disabled={busy || stagedFiles.length === 0} title="Unstage all" onclick={() => void mutate(() => unstageAllGitFiles(app.activeProject!.path))}>− All</button></div>
          </div>
          {#each stagedFiles as file (file.path)}
            <div class="flex items-center gap-0.5 rounded-md {selectedPath === file.path ? 'bg-studio-purple/15' : 'hover:bg-white/[0.03]'}">
              <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-[11px]" onclick={() => void loadDiff(file)}><span class="shrink-0 font-mono text-[10px] text-studio-text-dim">{statusCode(file)}</span><span class="truncate text-studio-text">{file.path}</span></button>
              <button type="button" class="px-1.5 text-studio-text-dim hover:text-studio-text" title="Unstage" aria-label={`Unstage ${file.path}`} onclick={() => void mutate(() => unstageGitFile(app.activeProject!.path, file.path))}>−</button>
            </div>
          {/each}
        </section>
        <section class="border-b border-border-subtle p-2">
          <div class="mb-1 flex items-center justify-between text-[10px] text-studio-text-dim">
            <span class="font-bold uppercase tracking-widest">Changes</span>
            <div class="flex items-center gap-1"><span>{changedFiles.length}</span><button type="button" class="rounded px-1.5 py-0.5 hover:bg-white/5 disabled:opacity-45" disabled={busy || changedFiles.length === 0} title="Stage all" onclick={() => void mutate(() => stageAllGitFiles(app.activeProject!.path))}>+ All</button></div>
          </div>
          {#each changedFiles as file (file.path)}
            <div class="flex items-center gap-0.5 rounded-md {selectedPath === file.path ? 'bg-studio-purple/15' : 'hover:bg-white/[0.03]'}">
              <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-[11px]" onclick={() => void loadDiff(file)}><span class="shrink-0 font-mono text-[10px] {file.conflicted ? 'text-studio-gold' : 'text-studio-text-dim'}">{statusCode(file)}</span><span class="truncate text-studio-text">{file.path}</span></button>
              <button type="button" class="px-1.5 text-studio-text-dim hover:text-studio-text" title="Stage" aria-label={`Stage ${file.path}`} onclick={() => void mutate(() => stageGitFile(app.activeProject!.path, file.path))}>+</button>
            </div>
          {/each}
        </section>
        <section class="p-2">
          <div class="mb-1 flex items-center justify-between text-[10px] text-studio-text-dim"><span class="font-bold uppercase tracking-widest">History</span><span>{history.length}</span></div>
          {#each history as commit (commit.hash)}
            <div class="mb-0.5">
              <button type="button" class="flex w-full items-start gap-1 rounded-md px-1 py-1 text-left hover:bg-white/[0.03] {selectedCommit?.hash === commit.hash && Boolean(selectedCommitPath) ? 'bg-studio-purple/10' : ''}" onclick={() => void toggleCommit(commit)}>
                <span class="mt-0.5 w-3 shrink-0 text-[10px] text-studio-text-dim">{expandedCommits[commit.hash] ? '⌄' : '›'}</span>
                <span class="min-w-0"><span class="block truncate text-[11px] text-studio-text">{commit.subject}</span><span class="block truncate font-mono text-[9px] text-studio-text-dim">{commit.shortHash} · {commit.author} · {new Date(commit.date).toLocaleDateString()}</span></span>
              </button>
              {#if expandedCommits[commit.hash]}
                <div class="ml-2 border-l border-border-subtle pl-1">
                  {#each treeRows(commitFiles[commit.hash] ?? [], commit.hash) as row (row.path)}
                    {#if row.file}
                      <button type="button" class="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] hover:bg-white/5 {selectedCommit?.hash === commit.hash && selectedCommitPath === row.path ? 'bg-studio-purple/15 text-studio-text' : 'text-studio-text-dim'}" style={`padding-left:${8 + row.depth * 14}px`} title={row.path} onclick={() => void loadCommitFile(commit, row.file!)}><span class="font-mono text-[9px]">{row.file.status}</span><span class="truncate">{row.name}</span></button>
                    {:else}
                      <button type="button" class="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] text-studio-gold hover:bg-white/5" style={`padding-left:${8 + row.depth * 14}px`} title={row.path} onclick={() => toggleFolder(commit.hash, row.path)}><span class="w-3">{collapsedFolders[`${commit.hash}:${row.path}`] ? '›' : '⌄'}</span><span class="truncate">{row.name}</span></button>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </section>
      </aside>
      <section class="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {#if error}<div class="px-3 py-2 font-mono text-[11px] text-danger">{error}</div>{/if}
        {#if selectedCommit}
          <div class="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2 text-[11px] text-studio-text-dim"><span class="truncate">{selectedCommitPath ?? selectedCommit.subject} · {selectedCommit.shortHash}</span><span class="shrink-0">{selectedCommit.author}</span></div>
          <div class="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-snug">{#each (diff || 'No textual diff.').split('\n') as line, index (`commit-${index}-${line}`)}<div class="min-h-[1.45em] whitespace-pre-wrap break-words px-3 {diffClass(line)}">{line || ' '}</div>{/each}</div>
        {:else if selected}
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2 text-[11px]">
            <span class="truncate text-studio-text">{selected.path}</span>
            <div class="flex flex-wrap gap-1">
              <button type="button" class="rounded-lg border border-border-subtle px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => app.openCodeFile(selected.path)}>Open</button>
              {#if selected.conflicted}
                <button type="button" class="rounded-lg border border-border-subtle px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => requestResolve(selected, 'ours')}>Use Current</button>
                <button type="button" class="rounded-lg border border-border-subtle px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => requestResolve(selected, 'theirs')}>Use Incoming</button>
                <button type="button" class="rounded-lg border border-border-subtle px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => requestResolve(selected, 'mark')}>Mark Resolved</button>
              {:else if selected.unstaged}
                <button type="button" class="rounded-lg border border-danger/30 px-2 py-0.5 text-[10px] text-danger hover:bg-danger-bg" onclick={() => requestDiscard(selected)}>Discard</button>
              {/if}
            </div>
          </div>
          {#if conflictDetail}
            <div class="grid min-h-0 flex-1 grid-cols-3 overflow-hidden border-t border-border-subtle">
              <section class="flex min-h-0 flex-col border-r border-border-subtle"><header class="border-b border-border-subtle px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-studio-text-dim">Base</header><div class="min-h-0 flex-1 overflow-auto font-mono text-[10px]">{#each (conflictDetail.base || '(no base)').split('\n') as line, index (`base-${index}-${line}`)}<pre class="m-0 whitespace-pre-wrap px-2">{line || ' '}</pre>{/each}</div></section>
              <section class="flex min-h-0 flex-col border-r border-border-subtle"><header class="border-b border-border-subtle px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-studio-text-dim">Current</header><div class="min-h-0 flex-1 overflow-auto font-mono text-[10px]">{#each (conflictDetail.ours || '(no current)').split('\n') as line, index (`ours-${index}-${line}`)}<pre class="m-0 whitespace-pre-wrap px-2">{line || ' '}</pre>{/each}</div></section>
              <section class="flex min-h-0 flex-col"><header class="border-b border-border-subtle px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-studio-text-dim">Incoming</header><div class="min-h-0 flex-1 overflow-auto font-mono text-[10px]">{#each (conflictDetail.theirs || '(no incoming)').split('\n') as line, index (`theirs-${index}-${line}`)}<pre class="m-0 whitespace-pre-wrap px-2">{line || ' '}</pre>{/each}</div></section>
            </div>
          {:else}
            <div class="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-snug">{#each (diff || 'No textual diff.').split('\n') as line, index (`${index}-${line}`)}<div class="min-h-[1.45em] whitespace-pre-wrap break-words px-3 {diffClass(line)}">{line || ' '}</div>{/each}</div>
          {/if}
        {:else if !loading}
          <div class="grid flex-1 place-items-center text-center text-studio-text-dim"><div><strong class="block text-sm text-studio-text">Working tree clean</strong><span class="text-xs">No changed files.</span></div></div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<ConfirmDialog
  open={discardTarget != null}
  title="Discard perubahan?"
  message={discardTarget ? `${discardTarget.path} akan dikembalikan dan perubahan tidak bisa dipulihkan.` : ''}
  cancelLabel="Batal"
  confirmLabel="Discard"
  danger
  onCancel={() => (discardTarget = null)}
  onConfirm={() => {
    const file = discardTarget
    discardTarget = null
    if (file) void mutate(() => discardGitFile(app.activeProject!.path, file.path, file.untracked))
  }}
/>

<ConfirmDialog
  open={pendingBranchSwitch != null}
  title="Working tree belum bersih"
  message={pendingBranchSwitch ? `Simpan perubahan ke stash lalu pindah ke ${pendingBranchSwitch.name}?` : ''}
  cancelLabel="Batal"
  confirmLabel="Stash & Switch"
  onCancel={() => (pendingBranchSwitch = null)}
  onConfirm={() => void confirmStashAndSwitch()}
/>

<ConfirmDialog
  open={deleteBranchTarget != null}
  title="Delete branch?"
  message={deleteBranchTarget ? `${deleteBranchTarget.name} hanya dihapus bila sudah merged.` : ''}
  cancelLabel="Batal"
  confirmLabel="Delete"
  danger
  onCancel={() => (deleteBranchTarget = null)}
  onConfirm={() => void confirmBranchDelete()}
/>

<ConfirmDialog
  open={resolveTarget != null}
  title="Resolve conflict?"
  message={
    resolveTarget?.resolution === 'mark'
      ? 'Stage file sebagai resolved tanpa mengganti isi.'
      : resolveTarget
        ? `Ganti isi dengan ${resolveTarget.resolution === 'ours' ? 'Current' : 'Incoming'} lalu stage file.`
        : ''
  }
  cancelLabel="Batal"
  confirmLabel="Lanjutkan"
  onCancel={() => (resolveTarget = null)}
  onConfirm={() => void confirmResolve()}
/>
