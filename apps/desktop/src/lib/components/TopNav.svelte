<script lang="ts">
  import { state, MODES } from '../store.svelte'

  let unreadNotifications = $derived(state.notifications.filter((item) => !item.read).length)
</script>

<header class="flex h-full w-full items-center justify-between gap-3">
  <div class="flex min-w-0 items-center gap-2">
    <span class="truncate text-[13px] font-semibold tracking-tight text-studio-text">
      {state.activeProject?.name ?? 'enpiistudio'}
    </span>
    {#if state.busy}
      <span class="studio-signal size-1.5 shrink-0 rounded-full" title="Running"></span>
    {/if}
  </div>

  <!-- macOS segmented control -->
  <div
    class="flex items-center rounded-lg bg-black/25 p-0.5 ring-1 ring-white/8"
    role="tablist"
    aria-label="Workspace mode"
  >
    {#each MODES as m}
      <button
        type="button"
        role="tab"
        aria-selected={state.mode === m.id}
        class="rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-100 {state.mode === m.id
          ? 'bg-studio-card text-studio-text shadow-sm ring-1 ring-white/10'
          : 'text-studio-text-dim hover:text-studio-text'}"
        onclick={() => state.setMode(m.id)}
      >
        {m.label}
      </button>
    {/each}
  </div>

  <div class="flex items-center gap-0.5">
    <button
      type="button"
      class="relative grid size-8 place-items-center rounded-full text-studio-text-dim transition-colors hover:bg-white/8 hover:text-studio-text {state.notificationsOpen
        ? 'bg-white/8 text-studio-text'
        : ''}"
      title="Notifications"
      aria-label="Notifications"
      data-notifications-trigger
      onclick={(e) => {
        e.stopPropagation()
        state.toggleNotifications()
      }}
    >
      <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
          d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .53-.21 1.04-.59 1.41L4 17h5m6 0a3 3 0 01-6 0h6z"
        ></path>
      </svg>
      {#if unreadNotifications}
        <span
          class="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-studio-gold px-1 text-center font-mono text-[9px] font-bold leading-[13px] text-studio-dark"
          >{unreadNotifications > 9 ? '9+' : unreadNotifications}</span
        >
      {/if}
    </button>
    <button
      type="button"
      class="grid size-8 place-items-center rounded-full text-studio-text-dim transition-colors hover:bg-white/8 hover:text-studio-text"
      title="Settings"
      aria-label="Settings"
      onclick={() => (state.settingsOpen = true)}
    >
      <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        ></path>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        ></path>
      </svg>
    </button>
  </div>
</header>
