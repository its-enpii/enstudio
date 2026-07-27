<script lang="ts">
  import { state, MODES } from '../store.svelte'

  let unreadNotifications = $derived(state.notifications.filter((item) => !item.read).length)
</script>

<header
  class="flex h-14 shrink-0 items-center justify-between rounded-2xl border border-border-subtle bg-studio-card/70 px-6 backdrop-blur-md"
>
  <div class="flex min-w-0 items-center gap-3">
    <div class="flex items-center gap-1.5" aria-hidden="true">
      <span class="size-2.5 rounded-full bg-[#ff5f57]"></span>
      <span class="size-2.5 rounded-full bg-[#febc2e]"></span>
      <span class="size-2.5 rounded-full bg-[#28c840]"></span>
    </div>
    <button
      type="button"
      class="grid place-items-center rounded-full p-1 text-studio-text-dim hover:bg-white/5 hover:text-studio-text"
      title="Back"
      aria-label="Back"
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        ></path>
      </svg>
    </button>
    <span class="truncate text-sm text-studio-text-dim"
      >{state.activeProject?.name ?? 'No project'}</span
    >
  </div>

  <div
    class="flex items-center gap-1 rounded-full border border-border-subtle bg-black/30 p-1 text-xs font-medium"
  >
    {#each MODES as m}
      <button
        type="button"
        class="rounded-full px-4 py-1 transition-colors {state.mode === m.id
          ? 'bg-studio-purple text-white'
          : 'text-studio-text-dim hover:text-white'}"
        onclick={() => state.setMode(m.id)}
      >
        {m.label}
      </button>
    {/each}
  </div>

  <div class="flex items-center gap-2">
    <button
      type="button"
      class="relative grid place-items-center rounded-full p-1 text-studio-text-dim hover:bg-white/5 hover:text-studio-text {state.notificationsOpen
        ? 'text-studio-text'
        : ''}"
      title="Notifications"
      aria-label="Notifications"
      onclick={() => state.toggleNotifications()}
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .53-.21 1.04-.59 1.41L4 17h5m6 0a3 3 0 01-6 0h6z"
        ></path>
      </svg>
      {#if unreadNotifications}
        <span
          class="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-studio-gold px-1 text-center text-[9px] font-bold leading-[14px] text-black"
          >{unreadNotifications > 9 ? '9+' : unreadNotifications}</span
        >
      {/if}
    </button>
    <button
      type="button"
      class="grid place-items-center rounded-full p-1 text-studio-text-dim hover:bg-white/5 hover:text-studio-text"
      title="Settings"
      aria-label="Settings"
      onclick={() => (state.settingsOpen = true)}
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      class="relative size-7 overflow-hidden rounded-full border border-border-subtle bg-studio-grey"
      title={state.activeProject?.name ?? 'No project'}
    >
      <div class="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-studio-gold"></div>
    </div>
  </div>
</header>
