<script lang="ts">
  import type { Snippet } from 'svelte'
  import { tick } from 'svelte'

  let {
    open = false,
    title,
    message = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
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
    class="confirm-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) cancel()
    }}
  >
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ui-confirm-title">
      <div class="confirm-icon">!</div>
      <div class="confirm-copy">
        <div id="ui-confirm-title" class="confirm-title">{title}</div>
        {#if children}
          <div class="confirm-message">{@render children()}</div>
        {:else if message}
          <div class="confirm-message">{message}</div>
        {/if}
      </div>
      <div class="confirm-actions">
        <button bind:this={cancelBtn} type="button" class="confirm-cancel" onclick={cancel}>{cancelLabel}</button>
        <button type="button" class={danger ? 'confirm-danger' : ''} onclick={confirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
