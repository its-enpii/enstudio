<script lang="ts">
  // Must alias — `import { state }` makes `$state` look like a store subscription
  import { state as app } from '../store.svelte'
  import { t } from '../i18n/index.svelte'

  function relativeTime(ts: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
    if (seconds < 60) return t('common.now')
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

  let panelEl: HTMLElement | undefined = $state()

  function onDoc(e: MouseEvent): void {
    if (!app.notificationsOpen) return
    const t = e.target as Node
    if (panelEl?.contains(t)) return
    const el = t instanceof Element ? t : t.parentElement
    if (el?.closest?.('[data-notifications-trigger]')) return
    app.notificationsOpen = false
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && app.notificationsOpen) app.notificationsOpen = false
  }
</script>

<svelte:window onclick={onDoc} onkeydown={onKey} />

{#if app.notificationsOpen}
  <div
    bind:this={panelEl}
    class="studio-glass fixed right-4 top-14 z-[230] flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-studio-panel/95 shadow-xl"
    aria-label={t('notifications.panel')}
    role="dialog"
    tabindex="-1"
  >
    <header class="flex items-center justify-between border-b border-border-subtle px-3 py-2.5">
      <strong class="text-[13px] font-semibold text-studio-text">{t('notifications.title')}</strong>
      {#if app.notifications.length}
        <button
          type="button"
          class="text-[11px] text-studio-text-dim hover:text-studio-text"
          onclick={() => app.clearNotifications()}>{t('notifications.clear')}</button
        >
      {/if}
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      {#each app.notifications as item (item.id)}
        <article class="mb-1.5 flex gap-2 rounded-md border p-2.5 {tone(item.type)}">
          <span class="mt-1.5 size-1.5 shrink-0 rounded-full {dot(item.type)}"></span>
          <div class="min-w-0 flex-1">
            <strong class="text-xs text-studio-text">{item.title}</strong>
            {#if item.detail}<p class="mt-0.5 text-[11px] text-studio-text-dim">{item.detail}</p>{/if}
          </div>
          <time class="shrink-0 text-[10px] text-studio-text-dim">{relativeTime(item.ts)}</time>
        </article>
      {:else}
        <div class="p-4 text-center text-xs text-studio-text-dim">{t('notifications.empty')}</div>
      {/each}
    </div>
  </div>
{/if}

<div class="pointer-events-none fixed bottom-4 right-4 z-[240] flex w-80 flex-col gap-2" aria-live="polite">
  {#each app.notifications.filter((item) => item.visible) as item (item.id)}
    <article
      class="pointer-events-auto flex gap-2 rounded-lg border border-border-subtle bg-studio-panel p-3 {tone(item.type)}"
    >
      <span class="mt-1.5 size-1.5 shrink-0 rounded-full {dot(item.type)}"></span>
      <div class="min-w-0 flex-1">
        <strong class="text-xs text-studio-text">{item.title}</strong>
        {#if item.detail}<p class="mt-0.5 text-[11px] text-studio-text-dim">{item.detail}</p>{/if}
      </div>
      <button
        type="button"
        class="text-studio-text-dim hover:text-studio-text"
        aria-label="Dismiss notification"
        onclick={() => app.dismissNotification(item.id)}>×</button
      >
    </article>
  {/each}
</div>
