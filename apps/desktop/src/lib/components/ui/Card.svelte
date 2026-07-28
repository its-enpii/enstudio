<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  type Tone = 'panel' | 'card' | 'dark'

  let {
    tone = 'card',
    padding = 'md',
    class: className = '',
    children,
    header,
    footer,
    ...rest
  }: {
    tone?: Tone
    padding?: 'none' | 'sm' | 'md' | 'lg'
    class?: string
    children?: Snippet
    header?: Snippet
    footer?: Snippet
  } & Omit<HTMLAttributes<HTMLDivElement>, 'class'> = $props()

  const tones: Record<Tone, string> = {
    panel: 'bg-studio-panel border-white/5',
    card: 'bg-studio-card border-white/5',
    dark: 'bg-studio-dark border-white/5',
  }
  // Min surface pad = 16 (p-4). sm collapses to md.
  const pads: Record<'none' | 'sm' | 'md' | 'lg', string> = {
    none: 'p-0',
    sm: 'p-4',
    md: 'p-4',
    lg: 'p-5',
  }
</script>

<div
  class="flex min-w-0 flex-col overflow-hidden rounded-lg border {tones[tone]} {pads[padding]} {className}"
  {...rest}
>
  {#if header}
    <div class="mb-3 shrink-0">{@render header()}</div>
  {/if}
  {#if children}
    <div class="min-h-0 min-w-0 flex-1">{@render children()}</div>
  {/if}
  {#if footer}
    <div class="mt-3 shrink-0">{@render footer()}</div>
  {/if}
</div>
