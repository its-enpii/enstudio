<script lang="ts">
  import type { Snippet } from 'svelte'
  import { tick } from 'svelte'
  import { t } from '../../i18n/index.svelte'

  let {
    open = false,
    title,
    message = '',
    confirmLabel = undefined,
    cancelLabel = undefined,
    danger = false,
    onConfirm,
    onCancel,
    children,
  }: {
    open?: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    onConfirm?: () => void
    onCancel?: () => void
    children?: Snippet
  } = $props()

  let cancelBtn = $state<HTMLButtonElement>()
  const resolvedCancel = $derived(cancelLabel ?? t('common.cancel'))
  const resolvedConfirm = $derived(confirmLabel ?? t('common.ok'))

  $effect(() => {
    if (open) void tick().then(() => cancelBtn?.focus())
  })

  function cancel(): void {
    onCancel?.()
  }

  function confirm(): void {
    onConfirm?.()
  }

  function onKey(e: KeyboardEvent): void {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    class="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) cancel()
    }}
  >
    <div
      class="w-full max-w-sm rounded-lg border border-border-subtle bg-studio-card p-5 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ui-confirm-title"
    >
      <div class="mb-3 flex size-9 items-center justify-center rounded-lg bg-studio-gold/15 text-sm font-bold text-studio-gold">
        !
      </div>
      <div class="mb-4">
        <div id="ui-confirm-title" class="text-sm font-semibold text-studio-text">{title}</div>
        {#if children}
          <div class="mt-1.5 text-xs leading-relaxed text-studio-text-dim">{@render children()}</div>
        {:else if message}
          <div class="mt-1.5 text-xs leading-relaxed text-studio-text-dim">{message}</div>
        {/if}
      </div>
      <div class="flex justify-end gap-2">
        <button
          bind:this={cancelBtn}
          type="button"
          class="rounded-lg border border-border-subtle px-4 py-2 text-xs text-studio-text-dim hover:bg-white/5 hover:text-studio-text"
          onclick={cancel}>{resolvedCancel}</button
        >
        <button
          type="button"
          class="rounded-lg px-4 py-2 text-xs font-medium {danger
            ? 'bg-danger-bg text-danger border border-danger/25'
            : 'bg-studio-purple text-white'}"
          onclick={confirm}>{resolvedConfirm}</button
        >
      </div>
    </div>
  </div>
{/if}
