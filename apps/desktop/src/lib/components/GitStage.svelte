<script lang="ts">
  import { untrack } from 'svelte'
  import { state as app } from '../store.svelte'
  import { bumpGitPanel, clearGitCommitSelection, gitPanel } from '../git-panel.svelte'
  import { Icon } from '../icons'
  import {
    applyGitStash,
    commitGitFiles,
    createGitBranch,
    createGitRelease,
    createGitStash,
    createGitTag,
    deleteGitBranch,
    deleteGitTag,
    discardGitFile,
    dropGitStash,
    getGitBranches,
    getGitConflict,
    getGitDiff,
    getGitRemotes,
    getGitStashes,
    getGitStatus,
    getGitTags,
    fetchGit,
    pullGit,
    pushGit,
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
    type GitBranch,
    type GitConflict,
    type GitFileStatus,
    type GitRemote,
    type GitStash,
    type GitStatus,
    type GitTag,
  } from '../enpii'
  import { t } from '../i18n/index.svelte'
  import { ConfirmDialog, Switch } from './ui'

  let status = $state<GitStatus | null>(null)
  let selectedPath = $state<string | null>(null)
  let diff = $state('')
  let loading = $state(false)
  let busy = $state(false)
  let error = $state('')
  let commitMessage = $state('')
  let discardTarget = $state<GitFileStatus | null>(null)
  let discardAllOpen = $state(false)
  let conflictDetail = $state<GitConflict | null>(null)
  let resolveTarget = $state<{ file: GitFileStatus; resolution: 'ours' | 'theirs' | 'mark' } | null>(null)
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

  let stashes = $state<GitStash[]>([])
  let tags = $state<GitTag[]>([])
  let stashMessage = $state('')
  let stashIncludeUntracked = $state(true)
  let dropStashTarget = $state<GitStash | null>(null)
  let deleteTagTarget = $state<GitTag | null>(null)
  let tagName = $state('')
  let tagMessage = $state('')
  let tagTarget = $state('HEAD')
  let releaseName = $state('')
  let releaseNotes = $state('')
  let releaseGithub = $state(true)
  let releaseInfo = $state('')

  const selected = $derived(status?.files.find((file) => file.path === selectedPath) ?? null)
  const stagedFiles = $derived(status?.files.filter((file) => file.staged) ?? [])
  const changedFiles = $derived(status?.files.filter((file) => file.unstaged) ?? [])
  const filteredBranches = $derived(branches.filter((branch) => branch.name.toLowerCase().includes(branchSearch.trim().toLowerCase())))
  const viewingCommit = $derived(Boolean(gitPanel.selectedCommit && gitPanel.selectedCommitPath))

  /** Color-only status: green=new, gold=mod, red=del (no letter icons). */
  function statusColor(file: GitFileStatus): string {
    if (file.conflicted) return 'text-studio-gold'
    if (file.untracked) return 'text-studio-success'
    const code = `${file.index}${file.worktree}`
    if (code.includes('D')) return 'text-danger'
    if (code.includes('A')) return 'text-studio-success'
    return 'text-studio-gold'
  }

  function statusLabel(file: GitFileStatus): string {
    if (file.conflicted) return 'conflict'
    if (file.untracked) return 'new'
    const code = `${file.index}${file.worktree}`
    if (code.includes('D')) return 'deleted'
    if (code.includes('A')) return 'new'
    return 'modified'
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
    clearGitCommitSelection()
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

  async function branchMutation(action: () => Promise<{ branches: GitBranch[]; status: GitStatus }>, close = true): Promise<void> {
    busy = true
    error = ''
    try {
      const result = await action()
      branches = result.branches
      status = result.status
      stashes = await getGitStashes(app.activeProject!.path)
      selectedPath = null
      clearGitCommitSelection()
      conflictDetail = null
      diff = ''
      bumpGitPanel()
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
      stashes = result.stashes
      selectedPath = null
      clearGitCommitSelection()
      diff = ''
      bumpGitPanel()
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
      stashes = await getGitStashes(project.path)
      tags = await getGitTags(project.path)
      const next = status.files.find((file) => file.path === selectedPath) ?? status.files[0]
      if (next) await loadDiff(next)
      else {
        selectedPath = null
        clearGitCommitSelection()
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
      commitMessage = ''
      selectedPath = status.files[0]?.path ?? null
      if (status.files[0]) await loadDiff(status.files[0])
      else {
        clearGitCommitSelection()
        diff = ''
      }
      bumpGitPanel()
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

  function requestDiscardAll(): void {
    if (changedFiles.length === 0) return
    discardAllOpen = true
  }

  async function confirmDiscardAll(): Promise<void> {
    const project = app.activeProject
    const files = [...changedFiles]
    discardAllOpen = false
    if (!project || files.length === 0) return
    await mutate(async () => {
      for (const file of files) {
        await discardGitFile(project.path, file.path, file.untracked)
      }
      return getGitStatus(project.path)
    })
  }

  async function createStash(): Promise<void> {
    const project = app.activeProject
    if (!project) return
    busy = true
    error = ''
    try {
      const result = await createGitStash(project.path, stashMessage, stashIncludeUntracked)
      stashes = result.stashes
      status = result.status
      stashMessage = ''
      selectedPath = status.files[0]?.path ?? null
      if (status.files[0]) await loadDiff(status.files[0])
      else {
        clearGitCommitSelection()
        diff = ''
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function applyStash(stash: GitStash, pop: boolean): Promise<void> {
    const project = app.activeProject
    if (!project) return
    busy = true
    error = ''
    try {
      const result = await applyGitStash(project.path, stash.ref, pop)
      stashes = result.stashes
      status = result.status
      const next = status.files[0]
      if (next) await loadDiff(next)
      else {
        selectedPath = null
        clearGitCommitSelection()
        diff = ''
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function confirmStashDrop(): Promise<void> {
    const stash = dropStashTarget
    const project = app.activeProject
    dropStashTarget = null
    if (!stash || !project) return
    busy = true
    error = ''
    try {
      stashes = await dropGitStash(project.path, stash.ref)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function createTag(): Promise<void> {
    const project = app.activeProject
    if (!project || !tagName.trim()) return
    busy = true
    error = ''
    try {
      tags = await createGitTag(project.path, tagName, tagMessage, tagTarget)
      tagName = ''
      tagMessage = ''
      tagTarget = 'HEAD'
      bumpGitPanel()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function confirmTagDelete(): Promise<void> {
    const tag = deleteTagTarget
    const project = app.activeProject
    deleteTagTarget = null
    if (!tag || !project) return
    busy = true
    error = ''
    try {
      tags = await deleteGitTag(project.path, tag.name)
      bumpGitPanel()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function createRelease(): Promise<void> {
    const project = app.activeProject
    if (!project || !releaseName.trim()) return
    busy = true
    error = ''
    releaseInfo = ''
    try {
      const result = await createGitRelease(
        project.path,
        releaseName.trim(),
        releaseNotes.trim() || undefined,
        'HEAD',
        remotes[0]?.name,
        releaseGithub,
      )
      tags = result.tags
      status = result.status
      releaseInfo = result.githubUrl
        ? `Released ${result.tag} → ${result.githubUrl}`
        : result.githubSkipped
          ? `Pushed ${result.tag} to ${result.remote} (GitHub: ${result.githubSkipped})`
          : `Pushed ${result.tag} to ${result.remote}`
      releaseName = ''
      releaseNotes = ''
      bumpGitPanel()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  $effect(() => {
    const projectId = app.activeProjectId
    const mode = app.mode
    if (!projectId || mode !== 'git') return
    if (currentProjectId !== projectId) {
      currentProjectId = projectId
      selectedPath = null
      clearGitCommitSelection()
      branches = []
      branchMenuOpen = false
      branchSearch = ''
      remotes = []
      stashes = []
      tags = []
      releaseInfo = ''
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
        bumpGitPanel()
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

  const inputCls =
    'w-full rounded-lg border-0 bg-black/25 px-2.5 py-2 text-[13px] text-studio-text outline-none ring-1 ring-white/8 placeholder:text-studio-text-dim/60 focus:ring-studio-purple/45'
  const btnCls =
    'rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-studio-text-dim ring-1 ring-white/8 hover:bg-white/[0.1] hover:text-studio-text disabled:opacity-40'
  const dangerBtn =
    'grid size-7 place-items-center rounded-md text-[14px] leading-none text-danger hover:bg-danger-bg disabled:opacity-40'
  const primaryBtn =
    'rounded-lg bg-studio-purple px-3 py-1.5 text-[12px] font-medium text-white shadow-sm hover:bg-studio-purple-bright disabled:opacity-40'
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
    <header class="flex min-h-9 items-center border-b border-border-subtle bg-studio-sidebar/60 px-3">
      <button type="button" class="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] text-studio-text-dim hover:bg-white/[0.05] hover:text-studio-text" aria-expanded={branchMenuOpen} onclick={() => (branchMenuOpen = !branchMenuOpen)}>
        <Icon name="git-branch" size={12} class="shrink-0 text-studio-success" />
        <strong class="font-semibold tracking-tight text-studio-text">{status?.branch ?? 'Git'}</strong>
        {#if status?.upstream}<span class="font-mono text-[11px]">{status.upstream}</span>{/if}
        {#if status?.ahead}<span class="inline-flex items-center gap-0.5 text-studio-gold"><Icon name="arrow-up" size={10} />{status.ahead}</span>{/if}
        {#if status?.behind}<span class="inline-flex items-center gap-0.5 text-studio-gold"><Icon name="arrow-down" size={10} />{status.behind}</span>{/if}
        <Icon name="chevron-down" size={12} class="ml-0.5 text-studio-text-dim/50" />
      </button>
    </header>
    {#if branchMenuOpen}
      <div class="fixed inset-0 z-[70]" role="presentation" onclick={() => (branchMenuOpen = false)}>
        <div class="studio-glass absolute left-3 top-12 z-[71] w-80 rounded-2xl bg-studio-popover/95 p-2" role="dialog" aria-label="Branch manager" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape') branchMenuOpen = false }}>
          <input class="mb-1.5 {inputCls}" bind:value={branchSearch} placeholder="Search branches" aria-label="Search branches" />
          <div class="mb-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
            <input class={inputCls} bind:value={newBranchName} placeholder="New branch" aria-label="New branch name" onkeydown={(event) => event.key === 'Enter' && createBranch()} />
            <button type="button" class={primaryBtn} disabled={busy || !newBranchName.trim()} onclick={createBranch}>Create</button>
          </div>
          <div class="max-h-80 overflow-auto">
            {#each filteredBranches as branch (branch.name)}
              <div class="grid min-h-[34px] grid-cols-[minmax(0,1fr)_25px_25px] items-center rounded-lg px-1 {branch.current ? 'bg-studio-purple/20' : 'hover:bg-white/[0.05]'}">
                {#if renamingBranch === branch.name}
                  <input class="col-span-3 {inputCls}" bind:value={renameBranchName} aria-label={`Rename ${branch.name}`} onkeydown={(event) => { if (event.key === 'Enter') renameBranch(branch); else if (event.key === 'Escape') renamingBranch = null }} />
                {:else}
                  <button type="button" class="grid min-w-0 grid-cols-[13px_minmax(0,1fr)] items-center gap-1.5 px-1 py-1 text-left text-[11px] text-studio-text-dim disabled:opacity-50" disabled={busy || branch.current} onclick={() => requestBranchSwitch(branch)}>
                    <span class="text-[10px]">{branch.current ? '●' : branch.remote ? '⇣' : '○'}</span>
                    <span class="flex min-w-0 flex-col">
                      <strong class="truncate text-[12px] font-medium text-studio-text">{branch.name}</strong>
                      {#if branch.upstream}<small class="truncate font-mono text-[10px] text-studio-text-dim">{branch.upstream}</small>{/if}
                    </span>
                  </button>
                  {#if !branch.remote}<button type="button" class="grid size-6 place-items-center rounded-full text-studio-text-dim hover:bg-white/8 hover:text-studio-text" title="Rename" aria-label={`Rename ${branch.name}`} onclick={() => startRename(branch)}><Icon name="pencil" size={11} /></button>{/if}
                  {#if !branch.remote && !branch.current}<button type="button" class="grid size-6 place-items-center rounded-full text-danger hover:bg-danger-bg" title="Delete" aria-label={`Delete ${branch.name}`} onclick={() => requestBranchDelete(branch)}><Icon name="close" size={11} /></button>{/if}
                {/if}
              </div>
            {/each}
            {#if filteredBranches.length === 0}<div class="px-2 py-3 text-center text-[11px] text-studio-text-dim">No matching branches.</div>{/if}
          </div>
        </div>
      </div>
    {/if}
    <div class="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-studio-sidebar/40 p-2.5">
        <div class="flex flex-col gap-1.5">
          <textarea class="{inputCls} min-h-[64px] resize-y" rows="3" bind:value={commitMessage} placeholder="Commit message"></textarea>
          <div class="flex gap-1.5">
            <button type="button" class={btnCls} disabled={busy || stagedFiles.length === 0} onclick={() => void autoCommitMessage()}>Auto</button>
            <button type="button" class="flex-1 {primaryBtn}" disabled={busy || !commitMessage.trim() || stagedFiles.length === 0} onclick={() => void commit()}>Commit {stagedFiles.length ? `(${stagedFiles.length})` : ''}</button>
          </div>
          <div class="flex gap-1">
            <button type="button" class="flex-1 {btnCls}" disabled={busy || remotes.length === 0} onclick={() => void syncRemote('fetch')}>Fetch</button>
            <button type="button" class="flex-1 {btnCls}" disabled={busy || remotes.length === 0 || !status?.upstream || (status?.files.length ?? 0) > 0} onclick={() => void syncRemote('pull')}>Pull</button>
            <button type="button" class="flex-1 {btnCls}" disabled={busy || remotes.length === 0} onclick={() => void syncRemote('push')}>Push</button>
          </div>
        </div>

        <section class="flex flex-col gap-1 rounded-xl bg-black/20 p-2.5 ring-1 ring-white/6">
          <div class="flex items-center justify-between gap-2 text-[12px] text-studio-text-dim">
            <span class="studio-label">Staged</span>
            <div class="flex items-center gap-0.5">
              <span class="mr-1 tabular-nums">{stagedFiles.length}</span>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text disabled:opacity-40"
                disabled={busy || stagedFiles.length === 0}
                title="Unstage all"
                aria-label="Unstage all"
                onclick={() => void mutate(() => unstageAllGitFiles(app.activeProject!.path))}
              ><Icon name="circle-minus" size={14} /></button>
            </div>
          </div>
          <div class="max-h-40 overflow-y-auto">
            {#each stagedFiles as file (file.path)}
              <div class="flex items-center gap-0.5 rounded-lg {!viewingCommit && selectedPath === file.path ? 'bg-studio-purple/20 ring-1 ring-studio-purple/25' : 'hover:bg-white/[0.05]'}">
                <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left text-[13px]" title={statusLabel(file)} onclick={() => void loadDiff(file)}><span class="truncate {statusColor(file)}">{file.path}</span></button>
                <button type="button" class="grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text" title="Unstage" aria-label={`Unstage ${file.path}`} onclick={() => void mutate(() => unstageGitFile(app.activeProject!.path, file.path))}><Icon name="circle-minus" size={14} /></button>
                <button type="button" class="grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-danger-bg hover:text-danger" title="Discard" aria-label={`Discard ${file.path}`} disabled={busy} onclick={() => requestDiscard(file)}><Icon name="trash" size={13} /></button>
              </div>
            {/each}
          </div>
        </section>

        <section class="flex flex-col gap-1 rounded-xl bg-black/20 p-2.5 ring-1 ring-white/6">
          <div class="flex items-center justify-between gap-2 text-[12px] text-studio-text-dim">
            <span class="studio-label">Changes</span>
            <div class="flex items-center gap-0.5">
              <span class="mr-1 tabular-nums">{changedFiles.length}</span>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text disabled:opacity-40"
                disabled={busy || changedFiles.length === 0}
                title="Stage all"
                aria-label="Stage all"
                onclick={() => void mutate(() => stageAllGitFiles(app.activeProject!.path))}
              ><Icon name="circle-plus" size={14} /></button>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-danger-bg hover:text-danger disabled:opacity-40"
                disabled={busy || changedFiles.length === 0}
                title="Discard all"
                aria-label="Discard all changes"
                onclick={requestDiscardAll}
              ><Icon name="trash" size={13} /></button>
            </div>
          </div>
          <div class="max-h-52 overflow-y-auto">
            {#each changedFiles as file (file.path)}
              <div class="flex items-center gap-0.5 rounded-lg {!viewingCommit && selectedPath === file.path ? 'bg-studio-purple/20 ring-1 ring-studio-purple/25' : 'hover:bg-white/[0.05]'}">
                <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left text-[13px]" title={statusLabel(file)} onclick={() => void loadDiff(file)}><span class="truncate {statusColor(file)}">{file.path}</span></button>
                <button type="button" class="grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text" title="Stage" aria-label={`Stage ${file.path}`} onclick={() => void mutate(() => stageGitFile(app.activeProject!.path, file.path))}><Icon name="circle-plus" size={14} /></button>
                <button type="button" class="grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-danger-bg hover:text-danger" title="Discard" aria-label={`Discard ${file.path}`} disabled={busy} onclick={() => requestDiscard(file)}><Icon name="trash" size={13} /></button>
              </div>
            {/each}
          </div>
        </section>

        <section class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-[11px] text-studio-text-dim">
            <span class="studio-label">Stashes</span>
            <span class="tabular-nums">{stashes.length}</span>
          </div>
          <input class={inputCls} bind:value={stashMessage} placeholder="Stash message" aria-label="Stash message" onkeydown={(e) => e.key === 'Enter' && void createStash()} />
          <Switch compact bind:checked={stashIncludeUntracked} description="Untracked" />
          <button type="button" class={btnCls} disabled={busy || (status?.files.length ?? 0) === 0} onclick={() => void createStash()}>Stash</button>
          {#each stashes as stash (stash.ref)}
            <div class="flex items-start gap-1 rounded-lg bg-black/20 p-2 ring-1 ring-white/6">
              <div class="min-w-0 flex-1">
                <strong class="block truncate text-[12px] text-studio-text">{stash.message}</strong>
                <span class="font-mono text-[10px] text-studio-text-dim">{stash.ref}{#if stash.branch} · {stash.branch}{/if}</span>
              </div>
              <button type="button" class={btnCls} disabled={busy} onclick={() => void applyStash(stash, false)}>Apply</button>
              <button type="button" class={btnCls} disabled={busy} onclick={() => void applyStash(stash, true)}>Pop</button>
              <button type="button" class="{dangerBtn} grid place-items-center" disabled={busy} aria-label={`Drop ${stash.ref}`} onclick={() => (dropStashTarget = stash)}><Icon name="trash" size={12} /></button>
            </div>
          {/each}
        </section>

        <section class="flex flex-col gap-1.5">
          <span class="studio-label">Release</span>
          <input class={inputCls} bind:value={releaseName} placeholder="v1.0.0" aria-label="Release version" onkeydown={(e) => e.key === 'Enter' && void createRelease()} />
          <textarea class="{inputCls} min-h-[64px] resize-y" rows="3" bind:value={releaseNotes} placeholder="Release notes (optional)" aria-label="Release notes"></textarea>
          <Switch compact bind:checked={releaseGithub} description="GitHub release" />
          <button type="button" class={primaryBtn} disabled={busy || !releaseName.trim() || remotes.length === 0} onclick={() => void createRelease()}>Create release</button>
          {#if releaseInfo}
            <div class="text-[11px] text-studio-text-dim">{releaseInfo}</div>
          {/if}
        </section>

        <section class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-[11px] text-studio-text-dim">
            <span class="studio-label">Tags</span>
            <span class="tabular-nums">{tags.length}</span>
          </div>
          <input class={inputCls} bind:value={tagName} placeholder="v1.0.0" aria-label="Tag name" onkeydown={(e) => e.key === 'Enter' && void createTag()} />
          <input class={inputCls} bind:value={tagMessage} placeholder="Optional message" aria-label="Tag message" />
          <input class={inputCls} bind:value={tagTarget} placeholder="HEAD" aria-label="Tag target" />
          <button type="button" class={btnCls} disabled={busy || !tagName.trim()} onclick={() => void createTag()}>Create</button>
          {#each tags as tag (tag.name)}
            <div class="flex items-start gap-1 rounded-lg bg-black/20 p-2 ring-1 ring-white/6">
              <div class="min-w-0 flex-1">
                <strong class="block truncate text-[12px] text-studio-text">{tag.name}</strong>
                <span class="font-mono text-[10px] text-studio-text-dim">{tag.shortHash} · {tag.subject || 'lightweight tag'}</span>
              </div>
              <button type="button" class="{dangerBtn} grid place-items-center" disabled={busy} onclick={() => (deleteTagTarget = tag)}><Icon name="trash" size={12} /></button>
            </div>
          {/each}
        </section>
      </aside>
      <section class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-studio-dark">
        {#if error}<div class="px-3 py-2 font-mono text-[11px] text-danger">{error}</div>{/if}
        {#if viewingCommit && gitPanel.selectedCommit}
          <div class="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2 text-[12px] text-studio-text-dim">
            <span class="truncate">{gitPanel.selectedCommitPath ?? gitPanel.selectedCommit.subject} · {gitPanel.selectedCommit.shortHash}</span>
            <span class="shrink-0">{gitPanel.selectedCommit.author}</span>
          </div>
          <div class="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-snug">
            {#each (gitPanel.commitDiff || 'No textual diff.').split('\n') as line, index (`commit-${index}-${line}`)}
              <div class="min-h-[1.45em] whitespace-pre-wrap break-words px-3 {diffClass(line)}">{line || ' '}</div>
            {/each}
          </div>
        {:else if selected}
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2 text-[12px]">
            <span class="truncate font-medium text-studio-text">{selected.path}</span>
            <div class="flex flex-wrap gap-1">
              <button type="button" class={btnCls} onclick={() => app.openCodeFile(selected.path)}>Open</button>
              {#if selected.conflicted}
                <button type="button" class={btnCls} onclick={() => requestResolve(selected, 'ours')}>Use Current</button>
                <button type="button" class={btnCls} onclick={() => requestResolve(selected, 'theirs')}>Use Incoming</button>
                <button type="button" class={btnCls} onclick={() => requestResolve(selected, 'mark')}>Mark Resolved</button>
              {:else if selected.unstaged}
                <button type="button" class="rounded-lg bg-danger-bg px-2.5 py-1 text-[11px] font-medium text-danger ring-1 ring-danger/25 hover:bg-danger-bg" onclick={() => requestDiscard(selected)}>Discard</button>
              {/if}
            </div>
          </div>
          {#if conflictDetail}
            <div class="grid min-h-0 flex-1 grid-cols-3 overflow-hidden border-t border-border-subtle">
              <section class="flex min-h-0 flex-col border-r border-border-subtle"><header class="border-b border-border-subtle px-2 py-1 studio-label">Base</header><div class="min-h-0 flex-1 overflow-auto font-mono text-[10px]">{#each (conflictDetail.base || '(no base)').split('\n') as line, index (`base-${index}-${line}`)}<pre class="m-0 whitespace-pre-wrap px-2">{line || ' '}</pre>{/each}</div></section>
              <section class="flex min-h-0 flex-col border-r border-border-subtle"><header class="border-b border-border-subtle px-2 py-1 studio-label">Current</header><div class="min-h-0 flex-1 overflow-auto font-mono text-[10px]">{#each (conflictDetail.ours || '(no current)').split('\n') as line, index (`ours-${index}-${line}`)}<pre class="m-0 whitespace-pre-wrap px-2">{line || ' '}</pre>{/each}</div></section>
              <section class="flex min-h-0 flex-col"><header class="border-b border-border-subtle px-2 py-1 studio-label">Incoming</header><div class="min-h-0 flex-1 overflow-auto font-mono text-[10px]">{#each (conflictDetail.theirs || '(no incoming)').split('\n') as line, index (`theirs-${index}-${line}`)}<pre class="m-0 whitespace-pre-wrap px-2">{line || ' '}</pre>{/each}</div></section>
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
  title={t('git.discardTitle')}
  message={discardTarget ? t('git.discardMsg', { path: discardTarget.path }) : ''}
  cancelLabel={t('git.cancel')}
  confirmLabel={t('git.discardConfirm')}
  danger
  onCancel={() => (discardTarget = null)}
  onConfirm={() => {
    const file = discardTarget
    discardTarget = null
    if (file) void mutate(() => discardGitFile(app.activeProject!.path, file.path, file.untracked))
  }}
/>

<ConfirmDialog
  open={discardAllOpen}
  title={t('git.discardAllTitle')}
  message={t('git.discardAllMsg', { count: changedFiles.length })}
  cancelLabel={t('git.cancel')}
  confirmLabel={t('git.discardAllConfirm')}
  danger
  onCancel={() => (discardAllOpen = false)}
  onConfirm={() => void confirmDiscardAll()}
/>

<ConfirmDialog
  open={pendingBranchSwitch != null}
  title={t('git.stashSwitchTitle')}
  message={pendingBranchSwitch ? t('git.stashSwitch', { name: pendingBranchSwitch.name }) : ''}
  cancelLabel={t('git.cancel')}
  confirmLabel={t('git.stashSwitchConfirm')}
  onCancel={() => (pendingBranchSwitch = null)}
  onConfirm={() => void confirmStashAndSwitch()}
/>

<ConfirmDialog
  open={deleteBranchTarget != null}
  title={t('git.deleteBranchTitle')}
  message={deleteBranchTarget ? t('git.deleteBranchMsg', { name: deleteBranchTarget.name }) : ''}
  cancelLabel={t('git.cancel')}
  confirmLabel={t('common.delete')}
  danger
  onCancel={() => (deleteBranchTarget = null)}
  onConfirm={() => void confirmBranchDelete()}
/>

<ConfirmDialog
  open={resolveTarget != null}
  title={t('git.resolveTitle')}
  message={
    resolveTarget?.resolution === 'mark'
      ? t('git.resolveMark')
      : resolveTarget
        ? t('git.resolveReplace', {
            side: resolveTarget.resolution === 'ours' ? t('git.resolveOurs') : t('git.resolveTheirs'),
          })
        : ''
  }
  cancelLabel={t('git.cancel')}
  confirmLabel={t('git.continue')}
  onCancel={() => (resolveTarget = null)}
  onConfirm={() => void confirmResolve()}
/>

<ConfirmDialog
  open={dropStashTarget != null}
  title={t('git.dropStashTitle')}
  message={dropStashTarget ? t('git.dropStashMsg', { ref: dropStashTarget.ref }) : ''}
  cancelLabel={t('git.cancel')}
  confirmLabel={t('git.dropStashConfirm')}
  danger
  onCancel={() => (dropStashTarget = null)}
  onConfirm={() => void confirmStashDrop()}
/>

<ConfirmDialog
  open={deleteTagTarget != null}
  title={t('git.deleteTagTitle')}
  message={deleteTagTarget ? t('git.deleteTagMsg', { name: deleteTagTarget.name }) : ''}
  cancelLabel={t('git.cancel')}
  confirmLabel={t('common.delete')}
  danger
  onCancel={() => (deleteTagTarget = null)}
  onConfirm={() => void confirmTagDelete()}
/>
