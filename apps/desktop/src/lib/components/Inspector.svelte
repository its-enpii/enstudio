<script lang="ts">
  import { state as app } from '../store.svelte'
  import {
    applyWorktreeSession,
    discardWorktreeSession,
    exportSessionMarkdown,
    listProjectWorktrees,
    newSession,
    openSession,
    openWorktreeByPath,
    pingEnpii,
    previewWorktreeSession,
    removeProjectWorktree,
    renameSession,
    setSessionLoadMemory,
    applyWorktreeAgents,
    promptManyAgents,
    startWorktreeAgents,
    startWorktreeSession,
    type WorktreeConflict,
    type WorktreeListItem,
    type WorktreePreview,
  } from '../enpii'
  import { ConfirmDialog, Switch } from './ui'
  import GitTools from './GitTools.svelte'

  let wtPreview = $state<WorktreePreview | null>(null)
  let wtBusy = $state(false)
  let wtError = $state('')
  let wtKeepBranch = $state(false)
  let wtConflicts = $state<WorktreeConflict[]>([])
  let wtList = $state<WorktreeListItem[]>([])
  let renamingId = $state<string | null>(null)
  let renameDraft = $state('')
  let renameBusy = $state(false)

  function startRename(s: { id: string; title: string }, e?: MouseEvent): void {
    e?.stopPropagation()
    renamingId = s.id
    renameDraft = s.title
  }

  async function commitRename(): Promise<void> {
    if (!renamingId || renameBusy) return
    const id = renamingId
    const title = renameDraft.trim()
    renameBusy = true
    try {
      if (title) await renameSession(title, id)
      renamingId = null
    } catch (err) {
      app.notify('error', 'Rename failed', err instanceof Error ? err.message : String(err))
    } finally {
      renameBusy = false
    }
  }

  function cancelRename(): void {
    renamingId = null
    renameDraft = ''
  }
  let discardWorktreeConfirm = $state(false)
  let removeWorktreePath = $state<string | null>(null)
  let applyAllConfirm = $state(false)
  let fanoutText = $state('')
  let fanoutBusy = $state(false)
  let applyAllReport = $state<
    | null
    | {
        applied: number
        ok: boolean
        lines: { label: string; detail: string; kind: 'ok' | 'skip' | 'conflict' }[]
        conflictPaths: string[]
        conflictBranch?: string
      }
  >(null)

  /** Worktree sessions from the one session list — no separate agent board. */
  const wtSessions = $derived(
    app.sessionList.filter((s) => Boolean(s.worktreeBranch || s.baseProjectRoot)),
  )
  const mainSessions = $derived(
    app.sessionList.filter((s) => !s.worktreeBranch && !s.baseProjectRoot),
  )
  /** Git checkouts with no matching agent session — only these need a separate row. */
  const orphanWorktrees = $derived.by(() => {
    const roots = new Set(
      wtSessions
        .map((s) => (s.projectRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase())
        .filter(Boolean),
    )
    return wtList.filter((wt) => {
      const p = wt.path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      return !roots.has(p)
    })
  })
  const wtBusyCount = $derived(
    wtSessions.filter((s) => app.isSessionBusy(s.id) || s.status === 'running' || s.status === 'awaiting_approval')
      .length,
  )

  async function onFanout(): Promise<void> {
    const text = fanoutText.trim()
    if (!text || fanoutBusy || wtSessions.length === 0) return
    fanoutBusy = true
    try {
      await promptManyAgents(text)
      fanoutText = ''
    } finally {
      fanoutBusy = false
    }
  }

  function requestApplyAllAgents(): void {
    if (fanoutBusy || wtSessions.length === 0) return
    applyAllConfirm = true
  }

  async function onApplyAllAgents(): Promise<void> {
    if (fanoutBusy || wtSessions.length === 0) return
    applyAllConfirm = false
    fanoutBusy = true
    applyAllReport = null
    try {
      const res = await applyWorktreeAgents({ keepBranch: wtKeepBranch })
      const lines = res.results.map((r) => {
        const label = r.branch ?? r.sessionId.slice(0, 8)
        if (r.ok) return { label, detail: r.removed ? 'merged · removed' : 'merged', kind: 'ok' as const }
        if (r.conflicts?.length) {
          return {
            label,
            detail: `conflict: ${r.conflicts.map((c) => c.path).join(', ')}`,
            kind: 'conflict' as const,
          }
        }
        return { label, detail: r.skipped ?? 'failed', kind: 'skip' as const }
      })
      const conflict = res.results.find((r) => r.conflicts?.length)
      applyAllReport = {
        applied: res.applied,
        ok: res.ok,
        lines,
        conflictPaths: conflict?.conflicts?.map((c) => c.path) ?? [],
        conflictBranch: conflict?.branch,
      }
      if (conflict?.conflicts?.length) {
        wtConflicts = conflict.conflicts
      }
      app.notify(
        res.ok ? 'info' : conflict ? 'warning' : 'error',
        'Apply all',
        res.ok
          ? `Applied ${res.applied}`
          : conflict
            ? `Stopped on conflicts in ${conflict.branch ?? 'agent'} (${conflict.conflicts!.length} file(s))`
            : `Applied ${res.applied}; check report`,
      )
      await listProjectWorktrees().then((list) => {
        wtList = list.filter((w) => !w.main)
      })
    } catch (err) {
      app.notify('error', 'Apply all failed', err instanceof Error ? err.message : String(err))
    } finally {
      fanoutBusy = false
    }
  }

  /** Server gates apply/discard on baseProjectRoot only — match that, not title/branch alone. */
  const isWorktreeSession = $derived(Boolean(app.session?.baseProjectRoot))

  $effect(() => {
    const id = app.session?.id
    const worktree = Boolean(app.session?.baseProjectRoot)
    if (!id || !worktree) {
      wtPreview = null
      wtError = ''
      wtConflicts = []
      return
    }
    let cancelled = false
    void previewWorktreeSession(id)
      .then((preview) => {
        if (!cancelled) {
          wtPreview = preview
          wtError = ''
        }
      })
      .catch((err) => {
        if (!cancelled) {
          wtPreview = null
          const raw = err instanceof Error ? err.message : String(err)
          wtError = /worktree not found/i.test(raw)
            ? 'Git worktree already removed (orphan session). Discard archives this chat.'
            : raw
        }
      })
    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    const projectPath = app.activeProject?.path
    // Re-fetch when session list / active worktree session changes.
    const sessionKey = `${app.session?.id ?? ''}:${app.sessionList.length}:${app.session?.worktreeBranch ?? ''}`
    if (!projectPath) {
      wtList = []
      return
    }
    void sessionKey
    let cancelled = false
    void listProjectWorktrees()
      .then((list) => {
        if (!cancelled) wtList = list.filter((w) => !w.main)
      })
      .catch(() => {
        if (!cancelled) wtList = []
      })
    return () => {
      cancelled = true
    }
  })

  let memoryChecked = $state(true)
  $effect(() => {
    memoryChecked = app.session?.loadMemory !== false
  })
  $effect(() => {
    const next = memoryChecked
    if (!app.session || next === (app.session.loadMemory !== false)) return
    void setSessionLoadMemory(next).catch((err) => {
      memoryChecked = app.session?.loadMemory !== false
      app.notify('error', 'Memory toggle failed', err instanceof Error ? err.message : String(err))
    })
  })

  function openWorktreeSessionByPath(wt: WorktreeListItem): void {
    void openWorktreeByPath(wt.path, wt.branch)
  }

  function requestRemoveWorktreePath(wtPath: string, e: MouseEvent): void {
    e.stopPropagation()
    if (app.session?.projectRoot === wtPath) {
      app.notify('error', 'Remove failed', 'Switch off this worktree session first')
      return
    }
    removeWorktreePath = wtPath
  }

  async function onRemoveWorktreePath(wtPath: string): Promise<void> {
    removeWorktreePath = null
    wtBusy = true
    try {
      const list = await removeProjectWorktree(wtPath)
      wtList = list.filter((w) => !w.main)
    } catch (err) {
      app.notify('error', 'Remove failed', err instanceof Error ? err.message : String(err))
    } finally {
      wtBusy = false
    }
  }

  async function onApplyWorktree(): Promise<void> {
    wtBusy = true
    try {
      const result = await applyWorktreeSession({ remove: true, keepBranch: wtKeepBranch })
      if (result?.conflicts?.length) {
        wtConflicts = result.conflicts
        wtError = `Merge conflict: ${result.conflicts.map((c) => c.path).join(', ')} — resolve in main checkout`
        return
      }
      wtConflicts = []
      wtPreview = null
    } finally {
      wtBusy = false
    }
  }

  async function onExportTranscript(): Promise<void> {
    try {
      await exportSessionMarkdown()
    } catch (err) {
      app.notify('error', 'Export failed', err instanceof Error ? err.message : String(err))
    }
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 10_000) return `${Math.round(n / 1000)}k`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  /** Session totals (preferred) or current-run snapshot. */
  const shownUsage = $derived(app.usage ?? app.run?.usage ?? null)

  async function onDiscardWorktree(): Promise<void> {
    wtBusy = true
    try {
      await discardWorktreeSession({ confirmed: true })
      wtPreview = null
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer-inner textarea')?.focus({ preventScroll: true }))
    } finally {
      wtBusy = false
    }
  }

  function requestDiscardWorktree(): void {
    discardWorktreeConfirm = true
  }

  function closeDiscardWorktreeDialog(): void {
    discardWorktreeConfirm = false
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer-inner textarea')?.focus({ preventScroll: true }))
  }

  async function onRefreshWorktree(): Promise<void> {
    if (!app.session?.id) return
    wtBusy = true
    try {
      wtPreview = await previewWorktreeSession(app.session.id)
      wtError = ''
    } catch (err) {
      wtError = err instanceof Error ? err.message : String(err)
    } finally {
      wtBusy = false
    }
  }

  function formatBytes(bytes: number): string {
    if (!bytes) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const statusLabel = $derived(
    app.approval
      ? 'Awaiting Approval'
      : app.enpiiStatus === 'ok'
        ? app.busy || app.session?.status === 'running'
          ? 'Agent Busy'
          : 'Ready'
        : app.enpiiStatus === 'error'
          ? 'Error'
          : 'Unknown',
  )

  const statusTone = $derived(
    app.enpiiStatus === 'error'
      ? 'border-studio-error/25 bg-studio-error/10 text-studio-error'
      : app.approval || app.session?.status === 'awaiting_approval'
        ? 'border-studio-gold/20 bg-studio-gold/10 text-studio-gold'
        : app.busy || app.session?.status === 'running'
          ? 'border-studio-gold/20 bg-studio-gold/10 text-studio-gold'
          : app.enpiiStatus === 'ok'
            ? 'border-studio-success/25 bg-studio-success/10 text-studio-success-bright'
            : 'border-border-subtle bg-studio-grey text-studio-text-dim',
  )
  const statusDot = $derived(
    app.enpiiStatus === 'error'
      ? 'bg-studio-error'
      : app.enpiiStatus === 'ok' && !app.busy && app.session?.status !== 'running' && !app.approval
        ? 'bg-studio-success'
        : app.enpiiStatus === 'ok' || app.busy || app.approval
          ? 'bg-studio-gold'
          : 'bg-studio-text-dim',
  )
</script>


<aside class="flex h-full w-full min-h-0 min-w-0 flex-col gap-5 overflow-x-hidden overflow-y-auto bg-transparent p-3">
  {#if app.mode === 'git'}
    <GitTools />
  {:else}
  <section class="flex shrink-0 flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="studio-label m-0">Run Status</h3>
      <button type="button" class="rounded-lg px-2.5 py-1 font-mono text-[11px] text-studio-text-dim transition-colors hover:bg-white/5 hover:text-studio-text" onclick={() => pingEnpii()}>Ping</button>
    </div>
    <div class="flex min-w-0 items-center gap-2.5 rounded-md border p-2.5 text-[12px] font-medium {statusTone}" title={app.enpiiInfo ?? undefined}>
      <div class="size-2 shrink-0 rounded-sm {statusDot} {app.busy || app.approval ? 'studio-signal' : ''}"></div>
      <span class="truncate">{statusLabel}</span>
    </div>
    {#if app.provider && !app.provider.hasKey}
      <div class="min-w-0 break-words text-[11px] leading-snug text-studio-text-dim"><span class="text-studio-gold">API key missing</span> · {app.provider.dialect}</div>
    {/if}
  </section>

  <section class="flex shrink-0 flex-col gap-3">
    <div class="m-0 flex items-center justify-between gap-2">
      <h3 class="studio-label m-0">Token Usage</h3>
      <span class="font-mono text-[10px] text-studio-text-dim" title={shownUsage ? `session in ${shownUsage.prompt} · out ${shownUsage.completion} · Σ ${shownUsage.total}` : 'No usage from endpoint yet'}>
        {#if shownUsage}
          {formatTokens(shownUsage.prompt)} / {formatTokens(shownUsage.completion)}
        {:else}
          — / —
        {/if}
      </span>
    </div>
    <div class="relative h-1.5 w-full overflow-hidden rounded-lg bg-studio-grey" title={shownUsage ? 'session completion share of total' : undefined}>
      <div
        class="h-full rounded-lg bg-studio-purple"
        style={shownUsage && shownUsage.total > 0
          ? `width:${Math.min(100, Math.round((shownUsage.completion / shownUsage.total) * 100))}%`
          : 'width:0'}
      ></div>
      {#if app.run?.maxTokens && app.run.usage}
        <div
          class="pointer-events-none absolute left-0 top-0 h-full rounded-lg bg-studio-gold/35"
          style={`width:${Math.min(100, Math.round((app.run.usage.total / app.run.maxTokens) * 100))}%`}
          title={`this run ${formatTokens(app.run.usage.total)} / budget ${formatTokens(app.run.maxTokens)}`}
        ></div>
      {/if}
    </div>
    {#if shownUsage}
      <div class="mt-1.5 flex flex-wrap gap-2 text-[11px] text-studio-text-dim">
        <span>session in {formatTokens(shownUsage.prompt)}</span>
        <span>out {formatTokens(shownUsage.completion)}</span>
        <span>Σ {formatTokens(shownUsage.total)}</span>
        {#if app.run?.usage && app.usage}
          <span title="last/current run only">run {formatTokens(app.run.usage.total)}</span>
        {/if}
        {#if app.run?.maxTokens && app.run.usage}
          <span class={app.run.usage.total / app.run.maxTokens > 0.85 ? 'text-studio-gold' : ''}>
            {Math.min(100, Math.round((app.run.usage.total / app.run.maxTokens) * 100))}% run budget
          </span>
        {/if}
      </div>
    {/if}
    {#if app.session}
      <div class="mt-0.5 min-w-0">
        <Switch compact bind:checked={memoryChecked} disabled={app.busy} description="Session memory" />
      </div>
    {/if}
  </section>

  {#if app.diffs.length > 0}
    <section class="flex min-h-0 shrink-0 flex-col gap-4">
      <h3 class="studio-label m-0">Recent Diffs</h3>
      <div class="flex max-h-36 min-w-0 flex-col gap-2 overflow-auto">
        {#each app.diffs as d (d.id)}
          <details class="rounded-lg border border-white/5 bg-studio-card p-4 text-xs hover:border-studio-purple/40">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span class="flex min-w-0 items-center gap-3 truncate text-studio-text">
                <svg class="size-3.5 shrink-0 text-studio-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                </svg>
                <span class="truncate font-mono">{d.summary.replace(/^(write_file|edit_file)\s+/, '').split(/\s+/)[0] ?? d.name}</span>
              </span>
              <span class="shrink-0">
                {#if d.path}
                  <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5 hover:text-studio-text" onclick={(event) => { event.preventDefault(); app.openCodeFile(d.path!) }}>Open</button>
                {:else}<span class="text-studio-gold">+</span>{/if}
              </span>
            </summary>
            {#if d.preview}
              <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-studio-text-dim">{d.preview}</pre>
            {/if}
          </details>
        {/each}
      </div>
    </section>
  {/if}

  <section class="flex shrink-0 flex-col gap-3">
    <h3 class="studio-label m-0">Sessions</h3>
    <div class="flex flex-wrap gap-1.5">
      <button type="button" class="rounded-lg bg-studio-purple px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-45" disabled={!app.activeProject} onclick={() => void newSession()}>New</button>
      <button type="button" class="rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] text-studio-text-dim hover:bg-white/5 disabled:opacity-45" disabled={!app.session || isWorktreeSession} title="Export transcript as Markdown" onclick={() => void onExportTranscript()}>Export</button>
    </div>
    {#if mainSessions.length > 0}
      <div class="flex flex-col gap-1">
        {#each mainSessions as s (s.id)}
          {#if renamingId === s.id}
            <div class="flex items-center gap-1 rounded-md border border-studio-purple/40 bg-studio-purple/10 p-1.5">
              <input class="min-w-0 flex-1 rounded-sm border border-border-subtle bg-studio-dark px-2 py-1 text-xs text-studio-text outline-none" bind:value={renameDraft} disabled={renameBusy} aria-label="Session title" onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitRename() } else if (e.key === 'Escape') { e.preventDefault(); cancelRename() } }} />
              <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" disabled={renameBusy} onclick={() => void commitRename()}>Save</button>
              <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" disabled={renameBusy} onclick={cancelRename}>×</button>
            </div>
          {:else}
            {@const active = app.session?.id === s.id}
            {@const running = app.isSessionBusy(s.id) || s.status === 'running' || s.status === 'awaiting_approval'}
            <div class="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors {active ? 'border-studio-purple/40 bg-studio-purple/15' : 'border-transparent hover:border-border-subtle hover:bg-white/[0.03]'} {running && !active ? 'opacity-90' : ''}" role="button" tabindex="0" onclick={() => void openSession(s.id)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openSession(s.id) } }}>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[12px] font-medium text-studio-text">{s.title}</span>
                <span class="block truncate text-[10px] text-studio-text-dim">{s.messageCount ?? 0} msg · {formatBytes(s.sizeBytes ?? 0)}</span>
              </span>
              <span class="shrink-0 text-[10px] text-studio-text-dim">{#if app.isSessionBusy(s.id) && s.id !== app.session?.id}running{:else}{s.status}{/if}</span>
              <button type="button" class="rounded-lg px-1.5 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5 hover:text-studio-text" title="Rename session" aria-label="Rename session" onclick={(e) => startRename(s, e)}>✎</button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </section>

  <section class="flex shrink-0 flex-col gap-3">
    <h3 class="studio-label m-0">Worktrees</h3>
    <div class="flex flex-wrap gap-1.5">
      <button type="button" class="rounded-lg border border-studio-purple/40 bg-studio-purple/15 px-3 py-1.5 text-[11px] font-medium text-studio-text hover:bg-studio-purple/25 disabled:opacity-45" disabled={!app.activeProject || wtBusy} title="Create sandbox worktree + chat" onclick={() => void startWorktreeSession()}>New</button>
      <button type="button" class="rounded-lg border border-studio-purple/40 bg-studio-purple/15 px-3 py-1.5 text-[11px] font-medium text-studio-text hover:bg-studio-purple/25 disabled:opacity-45" disabled={!app.activeProject || wtBusy} title="Spawn 2 parallel sandbox agents" onclick={() => void startWorktreeAgents(2)}>×2</button>
    </div>

    {#if isWorktreeSession}
      <div class="rounded-lg border border-border-subtle bg-studio-card p-4">
        <div class="mb-1.5 flex items-start justify-between gap-2">
          <span class="min-w-0 truncate text-xs font-medium text-studio-text"><code class="font-mono text-[11px]">{app.session?.worktreeBranch ?? app.session?.title ?? 'worktree'}</code></span>
          <div class="flex shrink-0 gap-1">
            <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" disabled={wtBusy || app.busy} onclick={() => void onRefreshWorktree()}>Refresh</button>
            <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-danger hover:bg-danger-bg" disabled={wtBusy || app.busy} title="Discard this worktree (tree + chat)" aria-label="Discard worktree" onclick={requestDiscardWorktree}>×</button>
          </div>
        </div>
        {#if wtError}
          <div class="mb-1 text-[11px] text-danger">{wtError}</div>
        {:else if wtPreview}
          <div class="text-[11px] text-studio-text-dim">
            {wtPreview.ahead} commit{wtPreview.ahead === 1 ? '' : 's'} ahead of {wtPreview.baseBranch}
            {#if wtPreview.dirty} · dirty{/if}
          </div>
          {#if wtPreview.commits.length}
            <ul class="mt-1 max-h-24 space-y-0.5 overflow-auto pl-0 text-[11px]">
              {#each wtPreview.commits.slice(0, 5) as c (`${c.shortHash}-${c.subject}`)}
                <li class="truncate text-studio-text-dim"><code class="font-mono text-studio-text">{c.shortHash}</code> {c.subject}</li>
              {/each}
            </ul>
          {/if}
          {#if wtPreview.files.length}
            <div class="mt-1 text-[11px] text-studio-text-dim">{wtPreview.files.length} file{wtPreview.files.length === 1 ? '' : 's'} changed</div>
          {/if}
        {:else}
          <div class="text-[11px] text-studio-text-dim">Loading preview…</div>
        {/if}
        {#if wtConflicts.length}
          <div class="mt-2">
            <div class="text-[11px] text-danger">Conflicts in main — resolve then commit:</div>
            <ul class="mt-1 space-y-0.5">
              {#each wtConflicts as c (c.path)}
                <li>
                  <button type="button" class="truncate text-left font-mono text-[11px] text-studio-gold hover:underline" title="Open in Code" onclick={() => app.openCodeFile(c.path)}><code>{c.path}</code></button>
                </li>
              {/each}
            </ul>
            <div class="mt-1.5 flex gap-1">
              <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => app.setMode('git')}>Open Git</button>
              <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => app.openCodeFile(wtConflicts[0]!.path)}>Open first</button>
            </div>
          </div>
        {/if}
        <div class="mt-2 min-w-0">
          <Switch compact bind:checked={wtKeepBranch} disabled={wtBusy || app.busy} description="Keep enpii/* branch" />
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <button type="button" class="rounded-lg bg-studio-purple px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-45" disabled={wtBusy || app.busy || !wtPreview || wtPreview.ahead === 0 || wtPreview.dirty} title={wtPreview?.dirty ? 'Commit worktree changes first' : 'Merge into main and remove worktree'} onclick={() => void onApplyWorktree()}>Apply</button>
          <button type="button" class="rounded-lg border border-danger/30 bg-danger-bg/30 px-3 py-1.5 text-[11px] text-danger disabled:opacity-45" disabled={wtBusy || app.busy} onclick={requestDiscardWorktree}>Discard</button>
        </div>
      </div>
    {/if}

    {#if wtSessions.length > 0}
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2 text-[10px] text-studio-text-dim">
          <span>{#if wtBusyCount > 0}{wtBusyCount}/{wtSessions.length} busy{/if}</span>
          <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] hover:bg-white/5 disabled:opacity-45" disabled={!isWorktreeSession} title="Export active worktree transcript" onclick={() => void onExportTranscript()}>Export</button>
        </div>
        <div class="flex flex-col gap-1">
          {#each wtSessions as s (s.id)}
            {#if renamingId === s.id}
              <div class="flex items-center gap-1 rounded-md border border-studio-purple/40 bg-studio-purple/10 p-1.5">
                <input class="min-w-0 flex-1 rounded-sm border border-border-subtle bg-studio-dark px-2 py-1 text-xs text-studio-text outline-none" bind:value={renameDraft} disabled={renameBusy} aria-label="Worktree title" onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitRename() } else if (e.key === 'Escape') { e.preventDefault(); cancelRename() } }} />
                <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" disabled={renameBusy} onclick={() => void commitRename()}>Save</button>
                <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" disabled={renameBusy} onclick={cancelRename}>×</button>
              </div>
            {:else}
              {@const active = app.session?.id === s.id}
              {@const running = app.isSessionBusy(s.id) || s.status === 'running' || s.status === 'awaiting_approval'}
              <div class="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 {active ? 'border-studio-purple/40 bg-studio-purple/15' : 'border-transparent hover:border-border-subtle hover:bg-white/[0.03]'}" role="button" tabindex="0" onclick={() => void openSession(s.id)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openSession(s.id) } }}>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[12px] font-medium text-studio-text">{s.worktreeBranch ?? s.title}</span>
                  <span class="block truncate text-[10px] text-studio-text-dim">{s.messageCount ?? 0} msg · {formatBytes(s.sizeBytes ?? 0)}</span>
                </span>
                <span class="shrink-0 text-[10px] text-studio-text-dim">{#if app.isSessionBusy(s.id) && s.id !== app.session?.id}running{:else}{s.status}{/if}</span>
                <button type="button" class="rounded-lg px-1.5 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" title="Rename" aria-label="Rename worktree session" onclick={(e) => startRename(s, e)}>✎</button>
              </div>
            {/if}
          {/each}
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <input class="min-w-0 flex-1 rounded-lg border border-border-subtle bg-studio-dark px-2.5 py-1 text-[11px] text-studio-text outline-none placeholder:text-studio-text-dim" type="text" placeholder="Fan-out to all worktrees…" bind:value={fanoutText} disabled={fanoutBusy} onkeydown={(e) => { if (e.key === 'Enter') void onFanout() }} />
          <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5 disabled:opacity-45" disabled={fanoutBusy || !fanoutText.trim()} onclick={() => void onFanout()}>Send all</button>
          <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5 disabled:opacity-45" disabled={fanoutBusy} title="Merge clean worktrees into main (sequential)" onclick={requestApplyAllAgents}>Apply all</button>
        </div>
        {#if applyAllReport}
          <div class="rounded-lg border p-4 {applyAllReport.ok ? 'border-border-subtle bg-studio-card' : 'border-danger/30 bg-danger-bg/20'}">
            <div class="mb-1 flex items-center justify-between text-[10px] text-studio-text-dim">
              <span>Apply all · {applyAllReport.applied} merged</span>
              <button type="button" class="rounded-lg px-1.5 hover:bg-white/5" onclick={() => (applyAllReport = null)}>×</button>
            </div>
            {#each applyAllReport.lines as line, i (`${line.label}-${i}`)}
              <div class="flex gap-2 text-[11px] {line.kind === 'ok' ? 'text-studio-success-bright' : line.kind === 'conflict' ? 'text-danger' : 'text-studio-text-dim'}">
                <code class="font-mono">{line.label}</code>
                <span class="min-w-0 truncate">{line.detail}</span>
              </div>
            {/each}
            {#if applyAllReport.conflictPaths.length}
              <div class="mt-1 text-[11px] text-danger">Conflicts{applyAllReport.conflictBranch ? ` (${applyAllReport.conflictBranch})` : ''}: resolve in main, then commit.</div>
              <ul class="mt-1 space-y-0.5">
                {#each applyAllReport.conflictPaths as p (p)}
                  <li><button type="button" class="font-mono text-[11px] text-studio-gold hover:underline" title="Open in Code" onclick={() => app.openCodeFile(p)}><code>{p}</code></button></li>
                {/each}
              </ul>
              <div class="mt-1.5 flex gap-1">
                <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => app.setMode('git')}>Open Git</button>
                <button type="button" class="rounded-lg px-2 py-0.5 text-[10px] text-studio-text-dim hover:bg-white/5" onclick={() => { const first = applyAllReport?.conflictPaths[0]; if (first) app.openCodeFile(first) }}>Open first</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if orphanWorktrees.length > 0}
      <details class="rounded-lg border border-border-subtle p-4" open>
        <summary class="cursor-pointer text-[10px] text-studio-text-dim">Orphan · {orphanWorktrees.length}</summary>
        {#each orphanWorktrees as wt (wt.path)}
          <div class="mt-1 flex items-center gap-1" title={wt.path}>
            <button type="button" class="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left hover:bg-white/5" onclick={() => openWorktreeSessionByPath(wt)}>
              <code class="font-mono text-[11px] text-studio-text">{wt.branch ?? wt.head.slice(0, 8)}</code>
              <span class="ml-1 text-[10px] text-studio-text-dim">{wt.path.split(/[\\/]/).slice(-1)[0]}</span>
            </button>
            <button type="button" class="rounded-lg px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger-bg disabled:opacity-45" disabled={wtBusy || app.busy} title="Remove unattached worktree" onclick={(e) => requestRemoveWorktreePath(wt.path, e)}>×</button>
          </div>
        {/each}
      </details>
    {/if}
  </section>
  {/if}
</aside>

<ConfirmDialog
  open={discardWorktreeConfirm}
  title="Close worktree?"
  message="Uncommitted changes will be lost."
  cancelLabel="Batal"
  confirmLabel="Close & Discard"
  danger
  onCancel={closeDiscardWorktreeDialog}
  onConfirm={() => {
    discardWorktreeConfirm = false
    void onDiscardWorktree()
  }}
/>

<ConfirmDialog
  open={removeWorktreePath != null}
  title="Remove worktree?"
  message={removeWorktreePath ?? ''}
  cancelLabel="Batal"
  confirmLabel="Remove"
  danger
  onCancel={() => (removeWorktreePath = null)}
  onConfirm={() => {
    if (removeWorktreePath) void onRemoveWorktreePath(removeWorktreePath)
  }}
/>

<ConfirmDialog
  open={applyAllConfirm}
  title="Apply all agents?"
  message={`Apply up to ${wtSessions.length} worktree agent(s) into main? Stops on first conflict.`}
  cancelLabel="Batal"
  confirmLabel="Apply all"
  onCancel={() => (applyAllConfirm = false)}
  onConfirm={() => void onApplyAllAgents()}
/>
