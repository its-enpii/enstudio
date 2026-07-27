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

  const isWorktreeSession = $derived(
    Boolean(app.session?.baseProjectRoot || app.session?.worktreeBranch),
  )

  $effect(() => {
    const id = app.session?.id
    const worktree = Boolean(app.session?.baseProjectRoot || app.session?.worktreeBranch)
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
          wtError = err instanceof Error ? err.message : String(err)
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

  const statusClass = $derived(
    app.enpiiStatus === 'error'
      ? 'err'
      : app.approval || app.session?.status === 'awaiting_approval'
        ? ''
        : app.busy || app.session?.status === 'running'
          ? ''
          : app.enpiiStatus === 'ok'
            ? 'ok'
            : 'idle',
  )
</script>

<aside class="inspector panel">
  <section class="insp-section insp-section-status">
    <div class="insp-header">
      <h3 class="insp-label">Run Status</h3>
      <button type="button" class="btn-ghost" onclick={() => pingEnpii()}>Ping</button>
    </div>
    <div class="status-pill {statusClass}">
      <div class="dot-gold"></div>
      <span>{statusLabel}</span>
    </div>
    {#if app.enpiiInfo}
      <div class="insp-meta">{app.enpiiInfo}</div>
    {/if}
    {#if app.provider}
      <div class="insp-meta">
        {app.provider.permissionMode} · {app.provider.dialect}
        {#if !app.provider.hasKey}
          · <span class="insp-warn">no key</span>
        {/if}
      </div>
    {/if}
  </section>

  <section class="insp-section">
    <div class="token-row">
      <h3 class="insp-label tight">Token Usage</h3>
      <span class="mono" title={shownUsage ? `session in ${shownUsage.prompt} · out ${shownUsage.completion} · Σ ${shownUsage.total}` : 'No usage from endpoint yet'}>
        {#if shownUsage}
          {formatTokens(shownUsage.prompt)} / {formatTokens(shownUsage.completion)}
        {:else}
          — / —
        {/if}
      </span>
    </div>
    <div class="token-bar" title={shownUsage ? 'session completion share of total' : undefined}>
      <div
        class="token-bar-fill"
        style={shownUsage && shownUsage.total > 0
          ? `width:${Math.min(100, Math.round((shownUsage.completion / shownUsage.total) * 100))}%`
          : 'width:0'}
      ></div>
      {#if app.run?.maxTokens && app.run.usage}
        <div
          class="token-bar-budget"
          style={`width:${Math.min(100, Math.round((app.run.usage.total / app.run.maxTokens) * 100))}%`}
          title={`this run ${formatTokens(app.run.usage.total)} / budget ${formatTokens(app.run.maxTokens)}`}
        ></div>
      {/if}
    </div>
    {#if shownUsage}
      <div class="token-meta muted">
        <span>session in {formatTokens(shownUsage.prompt)}</span>
        <span>out {formatTokens(shownUsage.completion)}</span>
        <span>Σ {formatTokens(shownUsage.total)}</span>
        {#if app.run?.usage && app.usage}
          <span title="last/current run only">run {formatTokens(app.run.usage.total)}</span>
        {/if}
        {#if app.run?.maxTokens && app.run.usage}
          <span class:token-hot={app.run.usage.total / app.run.maxTokens > 0.85}>
            {Math.min(100, Math.round((app.run.usage.total / app.run.maxTokens) * 100))}% run budget
          </span>
        {/if}
      </div>
    {:else}
      <div class="insp-meta">per-session · when endpoint returns usage</div>
    {/if}
    {#if app.session}
      <div class="insp-switch">
        <Switch compact bind:checked={memoryChecked} disabled={app.busy} description="Session memory" />
      </div>
    {/if}
  </section>

  <section class="insp-section insp-section-diffs">
    <h3 class="insp-label">Recent Diffs</h3>
    {#if app.diffs.length === 0}
      <div class="insp-meta">No pending diffs</div>
    {:else}
      <div class="diff-item">
        {#each app.diffs as d (d.id)}
          <details class="diff-row">
            <summary class="diff-row-main">
              <span class="diff-file">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  ></path>
                </svg>
                {d.summary.replace(/^(write_file|edit_file)\s+/, '').split(/\s+/)[0] ?? d.name}
              </span>
              <span class="diff-stat">
                {#if d.path}
                  <button type="button" class="diff-open" onclick={(event) => { event.preventDefault(); app.openCodeFile(d.path!) }}>Open</button>
                {:else}<span class="plus">{d.name}</span>{/if}
              </span>
            </summary>
            {#if d.preview}
              <pre class="diff-preview">{d.preview}</pre>
            {/if}
          </details>
        {/each}
      </div>
    {/if}
  </section>

  <section class="insp-section insp-section-session">
    <h3 class="insp-label">Agent Session</h3>
    <div class="session-actions">
      <button type="button" class="session-new" disabled={!app.activeProject} onclick={() => void newSession()}>
        New
      </button>
      <button
        type="button"
        class="session-new session-worktree"
        disabled={!app.activeProject || wtBusy}
        title="Create git worktree + jailed agent session"
        onclick={() => void startWorktreeSession()}
      >
        Worktree
      </button>
      <button
        type="button"
        class="session-new session-worktree"
        disabled={!app.activeProject || wtBusy}
        title="Spawn 2 isolated worktree agent sessions"
        onclick={() => void startWorktreeAgents(2)}
      >
        ×2
      </button>
    </div>
    {#if isWorktreeSession}
      <div class="worktree-banner">
        <div class="worktree-banner-row">
          <span class="worktree-banner-title">Isolated · <code>{app.session?.worktreeBranch ?? 'worktree'}</code></span>
          <div class="worktree-banner-actions">
            <button type="button" class="wt-mini" disabled={wtBusy || app.busy} onclick={() => void onRefreshWorktree()}>Refresh</button>
            <button type="button" class="wt-close" disabled={wtBusy || app.busy} title="Close and discard worktree" aria-label="Close and discard worktree" onclick={requestDiscardWorktree}>×</button>
          </div>
        </div>
        {#if wtError}
          <div class="worktree-error">{wtError}</div>
        {:else if wtPreview}
          <div class="worktree-meta">
            {wtPreview.ahead} commit{wtPreview.ahead === 1 ? '' : 's'} ahead of {wtPreview.baseBranch}
            {#if wtPreview.dirty} · dirty{/if}
          </div>
          {#if wtPreview.commits.length}
            <ul class="worktree-commits">
              {#each wtPreview.commits.slice(0, 5) as c (`${c.shortHash}-${c.subject}`)}
                <li><code>{c.shortHash}</code> {c.subject}</li>
              {/each}
            </ul>
          {/if}
          {#if wtPreview.files.length}
            <div class="worktree-files">{wtPreview.files.length} file{wtPreview.files.length === 1 ? '' : 's'} changed</div>
          {/if}
        {:else}
          <div class="worktree-meta">Loading preview…</div>
        {/if}
        {#if wtConflicts.length}
          <div class="worktree-conflicts">
            <div class="worktree-error">Conflicts in main — resolve then commit:</div>
            <ul class="worktree-commits conflict-paths">
              {#each wtConflicts as c (c.path)}
                <li>
                  <button
                    type="button"
                    class="conflict-path-btn"
                    title="Open in Code"
                    onclick={() => app.openCodeFile(c.path)}
                  ><code>{c.path}</code></button>
                </li>
              {/each}
            </ul>
            <div class="agent-fanout">
              <button type="button" class="wt-mini" onclick={() => app.setMode('git')}>Open Git</button>
              <button
                type="button"
                class="wt-mini"
                onclick={() => app.openCodeFile(wtConflicts[0]!.path)}
              >Open first</button>
            </div>
          </div>
        {/if}
        <div class="insp-switch">
          <Switch compact bind:checked={wtKeepBranch} disabled={wtBusy || app.busy} description="Keep enpii/* branch" />
        </div>
        <div class="worktree-actions">
          <button
            type="button"
            class="session-new session-worktree"
            disabled={wtBusy || app.busy || !wtPreview || wtPreview.ahead === 0 || wtPreview.dirty}
            title={wtPreview?.dirty ? 'Commit worktree changes first' : 'Merge into main and remove worktree'}
            onclick={() => void onApplyWorktree()}
          >
            Apply
          </button>
          <button
            type="button"
            class="session-new session-discard"
            disabled={wtBusy || app.busy}
            onclick={requestDiscardWorktree}
          >
            Discard
          </button>
        </div>
      </div>
    {/if}
    {#if app.sessionList.length === 0 && !app.session}
      <div class="insp-meta">No session yet</div>
    {:else}
      <div class="session-switcher">
        <div class="session-history-label">
          <span>
            {app.sessionList.length} session{app.sessionList.length === 1 ? '' : 's'}
            {#if wtSessions.length}
              · {wtBusyCount}/{wtSessions.length} wt busy
            {/if}
          </span>
          <button
            type="button"
            class="wt-mini"
            disabled={!app.session}
            title="Export transcript as Markdown"
            onclick={() => void onExportTranscript()}
          >Export</button>
        </div>
        <div class="session-history">
          {#each app.sessionList as s (s.id)}
            {#if renamingId === s.id}
              <div class="session-history-item session-rename-row" class:active={app.session?.id === s.id}>
                <input
                  class="session-rename-input"
                  bind:value={renameDraft}
                  disabled={renameBusy}
                  aria-label="Session title"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                />
                <button type="button" class="wt-mini" disabled={renameBusy} onclick={() => void commitRename()}>Save</button>
                <button type="button" class="wt-mini" disabled={renameBusy} onclick={cancelRename}>×</button>
              </div>
            {:else}
              <button type="button" class="session-history-item" class:active={app.session?.id === s.id} class:running={app.isSessionBusy(s.id) || s.status === 'running' || s.status === 'awaiting_approval'} onclick={() => void openSession(s.id)}>
                <span class="session-history-copy">
                  <span class="session-history-name">
                    {#if s.worktreeBranch || s.baseProjectRoot}<span class="wt-tag">wt</span>{/if}
                    {s.title}
                  </span>
                  <span class="session-history-meta">{s.messageCount ?? 0} msg · {formatBytes(s.sizeBytes ?? 0)}{#if s.worktreeBranch} · {s.worktreeBranch}{/if}</span>
                </span>
                <span class="session-history-status">
                  {#if app.isSessionBusy(s.id) && s.id !== app.session?.id}running
                  {:else}{s.status}{/if}
                </span>
                <button
                  type="button"
                  class="wt-mini session-rename-btn"
                  title="Rename session"
                  aria-label="Rename session"
                  onclick={(e) => startRename(s, e)}
                >✎</button>
              </button>
            {/if}
          {/each}
        </div>
        {#if wtSessions.length > 0}
          <div class="agent-fanout">
            <input
              class="agent-fanout-input"
              type="text"
              placeholder="Fan-out to all worktree sessions…"
              bind:value={fanoutText}
              disabled={fanoutBusy}
              onkeydown={(e) => {
                if (e.key === 'Enter') void onFanout()
              }}
            />
            <button
              type="button"
              class="wt-mini"
              disabled={fanoutBusy || !fanoutText.trim()}
              onclick={() => void onFanout()}
            >Send all</button>
            <button
              type="button"
              class="wt-mini"
              disabled={fanoutBusy}
              title="Merge clean worktree agents into main (sequential)"
              onclick={requestApplyAllAgents}
            >Apply all</button>
          </div>
          {#if applyAllReport}
            <div class="apply-all-report" class:bad={!applyAllReport.ok}>
              <div class="worktree-list-label muted">
                Apply all · {applyAllReport.applied} merged
                <button type="button" class="wt-mini" onclick={() => (applyAllReport = null)}>×</button>
              </div>
              {#each applyAllReport.lines as line, i (`${line.label}-${i}`)}
                <div class="apply-all-line {line.kind}">
                  <code>{line.label}</code>
                  <span>{line.detail}</span>
                </div>
              {/each}
              {#if applyAllReport.conflictPaths.length}
                <div class="worktree-error">
                  Conflicts{applyAllReport.conflictBranch ? ` (${applyAllReport.conflictBranch})` : ''}: resolve in main, then commit.
                </div>
                <ul class="worktree-commits conflict-paths">
                  {#each applyAllReport.conflictPaths as p (p)}
                    <li>
                      <button
                        type="button"
                        class="conflict-path-btn"
                        title="Open in Code"
                        onclick={() => app.openCodeFile(p)}
                      ><code>{p}</code></button>
                    </li>
                  {/each}
                </ul>
                <div class="agent-fanout">
                  <button type="button" class="wt-mini" onclick={() => app.setMode('git')}>Open Git</button>
                  <button
                    type="button"
                    class="wt-mini"
                    onclick={() => {
                      const first = applyAllReport?.conflictPaths[0]
                      if (first) app.openCodeFile(first)
                    }}
                  >Open first</button>
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
    {#if wtList.length > 0}
      <details class="worktree-list worktree-list-compact">
        <summary class="worktree-list-label muted">
          Git worktrees · {wtList.length}
        </summary>
        {#each wtList as wt (wt.path)}
          <div
            class="worktree-list-item"
            class:active={app.session?.projectRoot === wt.path}
            title={wt.path}
          >
            <button
              type="button"
              class="worktree-list-open"
              onclick={() => openWorktreeSessionByPath(wt)}
            >
              <code>{wt.branch ?? wt.head.slice(0, 8)}</code>
              <span class="muted">{wt.path.split(/[\\/]/).slice(-1)[0]}</span>
            </button>
            <button
              type="button"
              class="wt-mini worktree-list-remove"
              disabled={wtBusy || app.busy || app.session?.projectRoot === wt.path}
              title="Remove worktree"
              onclick={(e) => requestRemoveWorktreePath(wt.path, e)}
            >×</button>
          </div>
        {/each}
      </details>
    {/if}
  </section>

  <section class="insp-section insp-section-logs">
    <h3 class="insp-label">Logs</h3>
    <div class="log-box">{app.logs.slice(-12).join('\n') || '—'}</div>
  </section>
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
