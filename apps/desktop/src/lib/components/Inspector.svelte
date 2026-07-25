<script lang="ts">
  import { state } from '../store.svelte'
  import { pingEnpii, newSession, openSession } from '../enpii'

  const statusLabel = $derived(
    state.approval
      ? 'Awaiting Approval'
      : state.enpiiStatus === 'ok'
        ? state.busy || state.session?.status === 'running'
          ? 'Agent Busy'
          : 'Ready'
        : state.enpiiStatus === 'error'
          ? 'Error'
          : 'Unknown',
  )

  const statusClass = $derived(
    state.enpiiStatus === 'error'
      ? 'err'
      : state.approval || state.session?.status === 'awaiting_approval'
        ? ''
        : state.busy || state.session?.status === 'running'
          ? ''
          : state.enpiiStatus === 'ok'
            ? 'ok'
            : 'idle',
  )
</script>

<aside class="inspector panel">
  <section class="insp-section">
    <div class="insp-header">
      <h3 class="insp-label" style="margin:0">Run Status</h3>
      <button type="button" class="btn-ghost" onclick={() => pingEnpii()}>Ping</button>
    </div>
    <div class="status-pill {statusClass}">
      <div class="dot-gold"></div>
      <span>{statusLabel}</span>
    </div>
    {#if state.enpiiInfo}
      <div class="muted" style="margin-top:8px;font-size:11px">{state.enpiiInfo}</div>
    {/if}
  </section>

  <section class="insp-section">
    <div class="token-row">
      <h3 class="insp-label tight" style="margin:0">Token Usage</h3>
      <span class="mono">
        {#if state.usage}
          {state.usage.prompt} / {state.usage.completion}
        {:else}
          — / —
        {/if}
      </span>
    </div>
    <div class="token-bar">
      <div
        style={state.usage && state.usage.total > 0
          ? `width:${Math.min(100, Math.round((state.usage.completion / state.usage.total) * 100))}%`
          : 'width:0'}
      ></div>
    </div>
    {#if state.usage}
      <div class="muted" style="margin-top:6px;font-size:11px">total {state.usage.total}</div>
    {/if}
  </section>

  <section class="insp-section" style="flex:1;min-height:0">
    <h3 class="insp-label">Recent Diffs</h3>
    {#if state.diffs.length === 0}
      <div class="muted">No pending diffs</div>
    {:else}
      <div class="diff-item">
        {#each state.diffs as d (d.id)}
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
                <span class="plus">{d.name}</span>
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

  <section class="insp-section">
    <div class="insp-header">
      <h3 class="insp-label" style="margin:0">Sessions</h3>
      <button
        type="button"
        class="btn-ghost"
        disabled={!state.activeProject || state.busy}
        onclick={() => newSession()}
      >
        New
      </button>
    </div>
    {#if state.sessionList.length === 0 && !state.session}
      <div class="muted">No session yet</div>
    {:else}
      <div class="session-list">
        {#each state.sessionList.length ? state.sessionList : state.session ? [state.session] : [] as s (s.id)}
          <button
            type="button"
            class="session-item"
            class:active={state.session?.id === s.id}
            disabled={state.busy}
            onclick={() => void openSession(s.id)}
          >
            <div class="name">{s.title}</div>
            <div class="meta">{s.model} · {s.status}</div>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <section class="insp-section">
    <h3 class="insp-label">Logs</h3>
    <div class="log-box">{state.logs.slice(-12).join('\n') || '—'}</div>
  </section>
</aside>
