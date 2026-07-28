<script lang="ts">
  import { untrack } from 'svelte'
  import { state as app } from '../store.svelte'
  import { clearGitCommitSelection, focusGitCommit, gitPanel } from '../git-panel.svelte'
  import {
    getGitCommitDiff,
    getGitCommitFiles,
    getGitHistory,
    getGitRemotes,
    getGitStatus,
    type GitCommit,
    type GitCommitFile,
    type GitRemote,
    type GitStatus,
  } from '../enpii'

  let status = $state<GitStatus | null>(null)
  let remotes = $state<GitRemote[]>([])
  let history = $state<GitCommit[]>([])
  let commitFiles = $state<Record<string, GitCommitFile[]>>({})
  let expandedCommits = $state<Record<string, boolean>>({})
  let collapsedFolders = $state<Record<string, boolean>>({})
  let loading = $state(false)
  let busy = $state(false)
  let error = $state('')
  let projectId: string | null = null

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

  async function refresh(): Promise<void> {
    const project = app.activeProject
    if (!project) return
    loading = true
    error = ''
    try {
      status = await getGitStatus(project.path)
      remotes = await getGitRemotes(project.path)
      history = await getGitHistory(project.path)
      commitFiles = {}
      expandedCommits = {}
      collapsedFolders = {}
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      history = []
    } finally {
      loading = false
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
      const diff = await getGitCommitDiff(project.path, commit.hash, file.path)
      focusGitCommit(commit, file.path, diff)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      clearGitCommitSelection()
    } finally {
      busy = false
    }
  }

  function toggleFolder(commitHash: string, folderPath: string): void {
    const key = `${commitHash}:${folderPath}`
    collapsedFolders = { ...collapsedFolders, [key]: !collapsedFolders[key] }
  }

  $effect(() => {
    const id = app.activeProjectId
    const mode = app.mode
    const rev = gitPanel.revision
    if (!id || mode !== 'git') return
    if (projectId !== id) {
      projectId = id
      status = null
      remotes = []
      history = []
      commitFiles = {}
      expandedCommits = {}
      collapsedFolders = {}
      clearGitCommitSelection()
      error = ''
    }
    void rev
    untrack(() => void refresh())
  })
</script>

<div class="flex h-full min-h-0 flex-col gap-4">
  {#if error}
    <div class="rounded-lg bg-danger-bg px-2.5 py-1.5 text-[11px] text-danger">{error}</div>
  {/if}

  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="studio-label">Remote</span>
      <button
        type="button"
        class="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-studio-text-dim ring-1 ring-white/8 hover:bg-white/[0.1] hover:text-studio-text disabled:opacity-40"
        disabled={loading || busy}
        onclick={() => void refresh()}
      >
        {loading ? '…' : 'Refresh'}
      </button>
    </div>
    <div class="rounded-xl bg-black/20 p-3 ring-1 ring-white/6">
      <div class="flex items-center justify-between gap-2 py-1 text-[12px]">
        <span class="text-studio-text-dim">Remote</span>
        <strong class="truncate text-studio-text">{remotes[0]?.name ?? '—'}</strong>
      </div>
      <div class="flex items-center justify-between gap-2 py-1 text-[12px]">
        <span class="text-studio-text-dim">Branch</span>
        <strong class="truncate text-studio-text">{status?.branch ?? '—'}</strong>
      </div>
      <div class="flex items-center justify-between gap-2 py-1 text-[12px]">
        <span class="text-studio-text-dim">Upstream</span>
        <strong class="truncate text-studio-text">{status?.upstream ?? 'none'}</strong>
      </div>
      <div class="flex items-center justify-between gap-2 py-1 text-[12px]">
        <span class="text-studio-text-dim">Sync</span>
        <strong class="text-studio-text">
          {#if status?.ahead || status?.behind}↑{status?.ahead ?? 0} ↓{status?.behind ?? 0}{:else}up to date{/if}
        </strong>
      </div>
    </div>
  </section>

  <section class="flex min-h-0 flex-1 flex-col gap-1.5">
    <div class="flex items-center justify-between gap-2 px-0.5">
      <span class="studio-label">History</span>
      <span class="tabular-nums text-[11px] text-studio-text-dim">{history.length}</span>
    </div>

    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
      {#each history as commit (commit.hash)}
        {@const open = Boolean(expandedCommits[commit.hash])}
        {@const active =
          gitPanel.selectedCommit?.hash === commit.hash && Boolean(gitPanel.selectedCommitPath)}
        <div class="rounded-lg {open || active ? 'bg-white/[0.03]' : ''}">
          <button
            type="button"
            class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05] {active
              ? 'bg-studio-purple/20 ring-1 ring-studio-purple/30'
              : open
                ? 'bg-white/[0.04]'
                : ''}"
            onclick={() => void toggleCommit(commit)}
          >
            <span
              class="mt-0.5 grid size-4 shrink-0 place-items-center rounded text-[10px] text-studio-text-dim"
              >{open ? '⌄' : '›'}</span
            >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12px] font-medium leading-snug text-studio-text"
                >{commit.subject}</span
              >
              <span class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10px] text-studio-text-dim">
                <span class="rounded bg-white/6 px-1 py-px text-studio-lavender-muted">{commit.shortHash}</span>
                <span class="truncate">{commit.author}</span>
                <span>·</span>
                <span>{new Date(commit.date).toLocaleDateString()}</span>
              </span>
            </span>
          </button>
          {#if open}
            <div class="mx-2 mb-1.5 mt-0.5 space-y-px border-l border-white/8 pl-2">
              {#if !(commitFiles[commit.hash]?.length)}
                <div class="px-1 py-1.5 text-[10px] text-studio-text-dim">Loading files…</div>
              {:else}
                {#each treeRows(commitFiles[commit.hash] ?? [], commit.hash) as row (row.path)}
                  {#if row.file}
                    {@const selected =
                      gitPanel.selectedCommit?.hash === commit.hash &&
                      gitPanel.selectedCommitPath === row.path}
                    <button
                      type="button"
                      class="flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-[11px] leading-snug hover:bg-white/8 {selected
                        ? 'bg-studio-purple/25 text-studio-text'
                        : 'text-studio-text-dim hover:text-studio-text'}"
                      style={`padding-left:${6 + row.depth * 12}px`}
                      title={row.path}
                      disabled={busy}
                      onclick={() => void loadCommitFile(commit, row.file!)}
                    >
                      <span
                        class="w-3 shrink-0 text-center font-mono text-[10px] {row.file.status === 'A'
                          ? 'text-studio-success'
                          : row.file.status === 'D'
                            ? 'text-danger'
                            : 'text-studio-gold'}">{row.file.status}</span
                      >
                      <span class="min-w-0 truncate">{row.name}</span>
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="flex w-full items-center gap-1 rounded-md py-1 pr-1.5 text-left text-[11px] leading-snug text-studio-text-dim hover:bg-white/6 hover:text-studio-text"
                      style={`padding-left:${6 + row.depth * 12}px`}
                      title={row.path}
                      onclick={() => toggleFolder(commit.hash, row.path)}
                    >
                      <span class="w-3 shrink-0 text-center text-[10px]"
                        >{collapsedFolders[`${commit.hash}:${row.path}`] ? '›' : '⌄'}</span
                      >
                      <span class="min-w-0 truncate font-medium">{row.name}</span>
                    </button>
                  {/if}
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        {#if !loading}
          <div class="px-1 py-6 text-center text-[11px] text-studio-text-dim">No commits yet.</div>
        {/if}
      {/each}
    </div>
  </section>
</div>
