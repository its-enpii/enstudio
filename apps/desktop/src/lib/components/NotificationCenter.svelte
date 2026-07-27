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
</script>

{#if state.notificationsOpen}
  <button class="notification-backdrop" type="button" aria-label="Close notifications" onclick={() => (state.notificationsOpen = false)}></button>
  <section class="notification-panel" aria-label="Notifications">
    <header>
      <strong>Notifications</strong>
      {#if state.notifications.length}
        <button type="button" onclick={() => state.clearNotifications()}>Clear</button>
      {/if}
    </header>
    <div class="notification-history">
      {#each state.notifications as item (item.id)}
        <article class="notification-row" class:error={item.type === 'error'} class:warning={item.type === 'warning'} class:success={item.type === 'success'}>
          <span class="notification-dot"></span>
          <div>
            <strong>{item.title}</strong>
            {#if item.detail}<p>{item.detail}</p>{/if}
          </div>
          <time>{relativeTime(item.ts)}</time>
        </article>
      {:else}
        <div class="notification-empty">No notifications.</div>
      {/each}
    </div>
  </section>
{/if}

<div class="toast-stack" aria-live="polite">
  {#each state.notifications.filter((item) => item.visible) as item (item.id)}
    <article class="toast" class:error={item.type === 'error'} class:warning={item.type === 'warning'} class:success={item.type === 'success'}>
      <span class="notification-dot"></span>
      <div>
        <strong>{item.title}</strong>
        {#if item.detail}<p>{item.detail}</p>{/if}
      </div>
      <button type="button" aria-label="Dismiss notification" onclick={() => state.dismissNotification(item.id)}>×</button>
    </article>
  {/each}
</div>
