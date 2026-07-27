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
    if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
    if (line.startsWith('@@')) return 'hunk'
    if (line.startsWith('+')) return 'add'
    if (line.startsWith('-')) return 'del'
    return ''
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

<div class="git-stage">
  {#if !app.activeProject}
    <div class="placeholder-stage"><div><div class="ph-title">Open a project</div><div class="muted">Git mode needs a workspace.</div></div></div>
  {:else}
    <header class="git-toolbar">
      <button type="button" class="git-branch" aria-expanded={branchMenuOpen} onclick={() => (branchMenuOpen = !branchMenuOpen)}><span class="git-branch-dot"></span><strong>{status?.branch ?? 'Git'}</strong>{#if status?.upstream}<span>{status.upstream}</span>{/if}{#if status?.ahead}<span>↑{status.ahead}</span>{/if}{#if status?.behind}<span>↓{status.behind}</span>{/if}<span class="git-branch-caret">⌄</span></button>
    </header>
    {#if branchMenuOpen}
      <div class="git-branch-backdrop" role="presentation" onclick={() => (branchMenuOpen = false)}>
        <div class="git-branch-menu" role="dialog" aria-label="Branch manager" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape') branchMenuOpen = false }}>
          <input class="git-branch-search" bind:value={branchSearch} placeholder="Search branches" aria-label="Search branches" />
          <div class="git-branch-create"><input bind:value={newBranchName} placeholder="New branch" aria-label="New branch name" onkeydown={(event) => event.key === 'Enter' && createBranch()} /><button type="button" disabled={busy || !newBranchName.trim()} onclick={createBranch}>Create</button></div>
          <div class="git-branch-list">
            {#each filteredBranches as branch (branch.name)}
              <div class="git-branch-row" class:current={branch.current}>
                {#if renamingBranch === branch.name}
                  <input class="git-branch-rename" bind:value={renameBranchName} aria-label={`Rename ${branch.name}`} onkeydown={(event) => { if (event.key === 'Enter') renameBranch(branch); else if (event.key === 'Escape') renamingBranch = null }} />
                {:else}
                  <button type="button" class="git-branch-main" disabled={busy || branch.current} onclick={() => requestBranchSwitch(branch)}><span>{branch.current ? '●' : branch.remote ? '⇣' : '○'}</span><span><strong>{branch.name}</strong>{#if branch.upstream}<small>{branch.upstream}</small>{/if}</span></button>
                  {#if !branch.remote}<button type="button" class="git-branch-action" title="Rename" aria-label={`Rename ${branch.name}`} onclick={() => startRename(branch)}>✎</button>{/if}
                  {#if !branch.remote && !branch.current}<button type="button" class="git-branch-action danger" title="Delete" aria-label={`Delete ${branch.name}`} onclick={() => requestBranchDelete(branch)}>×</button>{/if}
                {/if}
              </div>
            {/each}
            {#if filteredBranches.length === 0}<div class="git-branch-empty">No matching branches.</div>{/if}
          </div>
        </div>
      </div>
    {/if}
    <div class="git-layout">
      <aside class="git-sidebar">
        <div class="git-commit-box">
          <textarea rows="3" bind:value={commitMessage} placeholder="Commit message"></textarea>
          <button type="button" class="git-auto-commit" disabled={busy || stagedFiles.length === 0} onclick={() => void autoCommitMessage()}>Auto</button>
          <button type="button" disabled={busy || !commitMessage.trim() || stagedFiles.length === 0} onclick={() => void commit()}>Commit {stagedFiles.length ? `(${stagedFiles.length})` : ''}</button>
          <div class="git-sync-row">
            <button type="button" class="git-sync" disabled={busy || remotes.length === 0} onclick={() => void syncRemote('fetch')}>Fetch</button>
            <button type="button" class="git-sync" disabled={busy || remotes.length === 0 || !status?.upstream || (status?.files.length ?? 0) > 0} onclick={() => void syncRemote('pull')}>Pull</button>
            <button type="button" class="git-sync" disabled={busy || remotes.length === 0} onclick={() => void syncRemote('push')}>Push</button>
          </div>
        </div>
        <section class="git-group">
          <div class="git-group-head"><span>Staged Changes</span><div><span>{stagedFiles.length}</span><button type="button" disabled={busy || stagedFiles.length === 0} title="Unstage all" onclick={() => void mutate(() => unstageAllGitFiles(app.activeProject!.path))}>− All</button></div></div>
          {#each stagedFiles as file (file.path)}
            <div class="git-file" class:active={selectedPath === file.path}>
              <button type="button" class="git-file-main" onclick={() => void loadDiff(file)}><span class="git-file-code">{statusCode(file)}</span><span class="git-file-name">{file.path}</span></button>
              <button type="button" class="git-file-action" title="Unstage" aria-label={`Unstage ${file.path}`} onclick={() => void mutate(() => unstageGitFile(app.activeProject!.path, file.path))}>−</button>
            </div>
          {/each}
        </section>
        <section class="git-group">
          <div class="git-group-head"><span>Changes</span><div><span>{changedFiles.length}</span><button type="button" disabled={busy || changedFiles.length === 0} title="Stage all" onclick={() => void mutate(() => stageAllGitFiles(app.activeProject!.path))}>+ All</button></div></div>
          {#each changedFiles as file (file.path)}
            <div class="git-file" class:active={selectedPath === file.path}>
              <button type="button" class="git-file-main" onclick={() => void loadDiff(file)}><span class="git-file-code" class:conflict={file.conflicted}>{statusCode(file)}</span><span class="git-file-name">{file.path}</span></button>
              <button type="button" class="git-file-action" title="Stage" aria-label={`Stage ${file.path}`} onclick={() => void mutate(() => stageGitFile(app.activeProject!.path, file.path))}>+</button>
            </div>
          {/each}
        </section>
        <section class="git-group git-history">
          <div class="git-group-head"><span>History</span><span>{history.length}</span></div>
          {#each history as commit (commit.hash)}
            <div class="git-commit-node">
              <button type="button" class="git-commit-row" class:active={selectedCommit?.hash === commit.hash && Boolean(selectedCommitPath)} onclick={() => void toggleCommit(commit)}>
                <span class="git-tree-chevron">{expandedCommits[commit.hash] ? '⌄' : '›'}</span>
                <span><span class="git-commit-subject">{commit.subject}</span><span class="git-commit-meta">{commit.shortHash} · {commit.author} · {new Date(commit.date).toLocaleDateString()}</span></span>
              </button>
              {#if expandedCommits[commit.hash]}
                <div class="git-commit-tree">
                  {#each treeRows(commitFiles[commit.hash] ?? [], commit.hash) as row (row.path)}
                    {#if row.file}
                      <button type="button" class="git-tree-row file" class:active={selectedCommit?.hash === commit.hash && selectedCommitPath === row.path} style={`padding-left:${8 + row.depth * 14}px`} title={row.path} onclick={() => void loadCommitFile(commit, row.file!)}>
                        <span class="git-tree-status">{row.file.status}</span><span>{row.name}</span>
                      </button>
                    {:else}
                      <button type="button" class="git-tree-row folder" style={`padding-left:${8 + row.depth * 14}px`} title={row.path} onclick={() => toggleFolder(commit.hash, row.path)}>
                        <span class="git-tree-chevron">{collapsedFolders[`${commit.hash}:${row.path}`] ? '›' : '⌄'}</span><span>{row.name}</span>
                      </button>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </section>
      </aside>
      <section class="git-diff">
        {#if error}<div class="git-error">{error}</div>{/if}
        {#if selectedCommit}
          <div class="git-diff-head"><span>{selectedCommitPath ?? selectedCommit.subject} · {selectedCommit.shortHash}</span><span>{selectedCommit.author}</span></div>
          <div class="git-diff-body">{#each (diff || 'No textual diff.').split('\n') as line, index (`commit-${index}-${line}`)}<div class="git-diff-line {diffClass(line)}">{line || ' '}</div>{/each}</div>
        {:else if selected}
          <div class="git-diff-head"><span>{selected.path}</span><div><button type="button" onclick={() => app.openCodeFile(selected.path)}>Open</button>{#if selected.conflicted}<button type="button" onclick={() => requestResolve(selected, 'ours')}>Use Current</button><button type="button" onclick={() => requestResolve(selected, 'theirs')}>Use Incoming</button><button type="button" onclick={() => requestResolve(selected, 'mark')}>Mark Resolved</button>{:else if selected.unstaged}<button type="button" class="danger" onclick={() => requestDiscard(selected)}>Discard</button>{/if}</div></div>
          {#if conflictDetail}
            <div class="git-conflict-grid">
              <section><header>Base</header><div>{#each (conflictDetail.base || '(no base)').split('\n') as line, index (`base-${index}-${line}`)}<pre>{line || ' '}</pre>{/each}</div></section>
              <section><header>Current</header><div>{#each (conflictDetail.ours || '(no current)').split('\n') as line, index (`ours-${index}-${line}`)}<pre>{line || ' '}</pre>{/each}</div></section>
              <section><header>Incoming</header><div>{#each (conflictDetail.theirs || '(no incoming)').split('\n') as line, index (`theirs-${index}-${line}`)}<pre>{line || ' '}</pre>{/each}</div></section>
            </div>
          {:else}
            <div class="git-diff-body">{#each (diff || 'No textual diff.').split('\n') as line, index (`${index}-${line}`)}<div class="git-diff-line {diffClass(line)}">{line || ' '}</div>{/each}</div>
          {/if}
        {:else if !loading}<div class="git-clean"><strong>Working tree clean</strong><span>No changed files.</span></div>{/if}
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
