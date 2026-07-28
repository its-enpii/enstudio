<script lang="ts">
  import type { Snippet } from 'svelte'
  import { tick } from 'svelte'

  type Size = 'sm' | 'md' | 'lg' | 'xl'

  let {
    open = false,
    title = '',
    size = 'md',
    closeOnBackdrop = true,
    closeOnEscape = true,
    onClose,
    children,
    footer,
    header,
  }: {
    open?: boolean
    title?: string
    size?: Size
    closeOnBackdrop?: boolean
    closeOnEscape?: boolean
    onClose?: () => void
    children?: Snippet
    footer?: Snippet
    header?: Snippet
  } = $props()

  let panelEl = $state<HTMLDivElement>()

  const widths: Record<Size, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  }

  $effect(() => {
    if (open) void tick().then(() => panelEl?.focus())
  })

  function close(): void {
    onClose?.()
  }

  function onKey(e: KeyboardEvent): void {
    if (!open || !closeOnEscape) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    class="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
    role="presentation"
    onclick={(e) => {
      if (closeOnBackdrop && e.target === e.currentTarget) close()
    }}
  >
    <div
      class="flex max-h-[min(90vh,720px)] w-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-studio-card shadow-2xl {widths[size]}"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'ui-modal-title' : undefined}
      tabindex="-1"
      bind:this={panelEl}
    >
      {#if header}
        <div class="shrink-0 border-b border-border-subtle p-4">{@render header()}</div>
      {:else if title}
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle p-4">
          <h2 id="ui-modal-title" class="m-0 text-sm font-semibold text-studio-text">{title}</h2>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-lg text-studio-text-dim hover:bg-white/5 hover:text-white"
            aria-label="Close"
            onclick={close}
          >
            <svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      {/if}

      {#if children}
        <div class="min-h-0 flex-1 overflow-y-auto p-4">{@render children()}</div>
      {/if}

      {#if footer}
        <div class="shrink-0 border-t border-border-subtle p-4">{@render footer()}</div>
      {/if}
    </div>
  </div>
{/if}
