<script lang="ts">
  import { state, type Mode } from '../store.svelte'

  const modes: { id: Mode; label: string }[] = [
    { id: 'agent', label: 'Agent' },
    { id: 'code', label: 'Code' },
    { id: 'terminal', label: 'Terminal' },
  ]
</script>

<header class="topnav">
  <button type="button" class="icon-ghost" title="Back" aria-label="Back">
    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        d="M10 19l-7-7m0 0l7-7m-7 7h18"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></path>
    </svg>
  </button>

  <div class="mode-group">
    {#each modes as m}
      <button
        type="button"
        class="mode"
        class:active={state.mode === m.id}
        onclick={() => state.setMode(m.id)}
      >
        {m.label}
      </button>
    {/each}
  </div>

  <div class="avatar" title={state.activeProject?.name ?? 'No project'}>
    <div class="avatar-dot"></div>
  </div>
</header>
