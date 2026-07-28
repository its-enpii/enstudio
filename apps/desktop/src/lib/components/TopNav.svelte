<script lang="ts">
  import { state, MODES } from '../store.svelte'

  let unreadNotifications = $derived(state.notifications.filter((item) => !item.read).length)
</script>

<header
  class="flex h-14 shrink-0 items-center justify-between rounded-xl border border-[color:var(--color-chrome-border)] bg-studio-card/70 px-6 backdrop-blur-[12px] transition-[border-color] duration-150 hover:border-[color:var(--color-chrome-border-hover)]"
>
  <button
    type="button"
    class="grid size-9 place-items-center rounded-lg text-studio-text-dim transition-colors hover:bg-white/5 hover:text-white"
    title="Back"
    aria-label="Back"
  >
    <svg class="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 19l-7-7m0 0l7-7m-7 7h18"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></path>
    </svg>
  </button>

  <div
    class="flex items-center gap-1 rounded-lg border border-studio-purple/20 bg-black/35 p-1 text-xs font-medium"
    role="tablist"
    aria-label="Workspace mode"
  >
    {#each MODES as m}
      <button
        type="button"
        role="tab"
        aria-selected={state.mode === m.id}
        class="rounded-md px-4 py-1.5 tracking-wide transition-[background,color,box-shadow] duration-150 {state.mode === m.id
          ? 'bg-studio-purple text-white shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-studio-lavender)_25%,transparent)]'
          : 'text-studio-text-dim hover:bg-white/[0.04] hover:text-white'}"
        onclick={() => state.setMode(m.id)}
      >
        {m.label}
      </button>
    {/each}
  </div>

  <div class="flex items-center gap-1.5">
    <button
      type="button"
      class="relative grid size-9 place-items-center rounded-lg text-studio-text-dim transition-colors hover:bg-white/5 hover:text-studio-text {state.notificationsOpen
        ? 'bg-white/5 text-studio-text'
        : ''}"
      title="Notifications"
      aria-label="Notifications"
      onclick={() => state.toggleNotifications()}
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .53-.21 1.04-.59 1.41L4 17h5m6 0a3 3 0 01-6 0h6z"
        ></path>
      </svg>
      {#if unreadNotifications}
        <span
          class="absolute right-1 top-1 min-w-3.5 rounded-md bg-studio-gold px-1 text-center font-mono text-[9px] font-bold leading-[14px] text-studio-dark"
          >{unreadNotifications > 9 ? '9+' : unreadNotifications}</span
        >
      {/if}
    </button>
    <button
      type="button"
      class="grid size-9 place-items-center rounded-lg text-studio-text-dim transition-colors hover:bg-white/5 hover:text-studio-text"
      title="Settings"
      aria-label="Settings"
      onclick={() => (state.settingsOpen = true)}
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        ></path>
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        ></path>
      </svg>
    </button>
    <div
      class="relative size-8 overflow-hidden rounded-lg border border-studio-purple/25 bg-studio-grey"
      title={state.activeProject?.name ?? 'No project'}
      aria-hidden="true"
    >
      <div
        class="absolute inset-0 opacity-40"
        style="background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--color-studio-purple) 55%, transparent), transparent 70%)"
      ></div>
      {#if state.busy}
        <div class="studio-signal absolute bottom-1 right-1 size-1.5 rounded-sm"></div>
      {:else}
        <div class="absolute bottom-1 right-1 size-1.5 rounded-sm bg-studio-text-dim/50"></div>
      {/if}
    </div>
  </div>
</header>
