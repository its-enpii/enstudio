<script lang="ts">
  import { state } from '../store.svelte'

  function relativeTime(ts: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
    if (seconds < 60) return 'now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
  }

  function tone(type: string): string {
    if (type === 'error') return 'border-danger/30 bg-danger-bg/40'
    if (type === 'warning') return 'border-studio-gold/30 bg-studio-gold/10'
    if (type === 'success') return 'border-studio-success/30 bg-studio-success/10'
    return 'border-border-subtle bg-studio-card'
  }

  function dot(type: string): string {
    if (type === 'error') return 'bg-danger'
    if (type === 'warning') return 'bg-studio-gold'
    if (type === 'success') return 'bg-studio-success'
    return 'bg-studio-purple'
  }
</script>

{#if state.notificationsOpen}
  <button
    class="fixed inset-0 z-[220] bg-black/40"
    type="button"
    aria-label="Close notifications"
    onclick={() => (state.notificationsOpen = false)}
  ></button>
  <section
    class="fixed right-4 top-16 z-[230] flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-lg border border-border-subtle bg-studio-card shadow-2xl"
    aria-label="Notifications"
  >
    <header class="flex items-center justify-between border-b border-border-subtle p-4">
      <strong class="text-sm text-studio-text">Notifications</strong>
      {#if state.notifications.length}
        <button
          type="button"
          class="text-[11px] text-studio-text-dim hover:text-studio-text"
          onclick={() => state.clearNotifications()}>Clear</button
        >
      {/if}
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      {#each state.notifications as item (item.id)}
        <article class="mb-2 flex gap-2 rounded-lg border p-4 {tone(item.type)}">
          <span class="mt-1.5 size-1.5 shrink-0 rounded-lg {dot(item.type)}"></span>
          <div class="min-w-0 flex-1">
            <strong class="text-xs text-studio-text">{item.title}</strong>
            {#if item.detail}<p class="mt-0.5 text-[11px] text-studio-text-dim">{item.detail}</p>{/if}
          </div>
          <time class="shrink-0 text-[10px] text-studio-text-dim">{relativeTime(item.ts)}</time>
        </article>
      {:else}
        <div class="p-4 text-center text-xs text-studio-text-dim">No notifications.</div>
      {/each}
    </div>
  </section>
{/if}

<div class="pointer-events-none fixed bottom-4 right-4 z-[240] flex w-80 flex-col gap-2" aria-live="polite">
  {#each state.notifications.filter((item) => item.visible) as item (item.id)}
    <article
      class="pointer-events-auto flex gap-2 rounded-lg border p-4 shadow-xl {tone(item.type)}"
    >
      <span class="mt-1.5 size-1.5 shrink-0 rounded-lg {dot(item.type)}"></span>
      <div class="min-w-0 flex-1">
        <strong class="text-xs text-studio-text">{item.title}</strong>
        {#if item.detail}<p class="mt-0.5 text-[11px] text-studio-text-dim">{item.detail}</p>{/if}
      </div>
      <button
        type="button"
        class="text-studio-text-dim hover:text-studio-text"
        aria-label="Dismiss notification"
        onclick={() => state.dismissNotification(item.id)}>×</button
      >
    </article>
  {/each}
</div>
