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
    panel: 'bg-studio-panel border-border-subtle',
    card: 'bg-studio-card border-border-subtle',
    dark: 'bg-studio-dark border-border-subtle',
  }
  const pads: Record<'none' | 'sm' | 'md' | 'lg', string> = {
    none: 'p-0',
    sm: 'p-2.5',
    md: 'p-3',
    lg: 'p-4',
  }
</script>

<div
  class="flex min-w-0 flex-col overflow-hidden rounded-lg border {tones[tone]} {pads[padding]} {className}"
  {...rest}
>
  {#if header}
    <div class="mb-2.5 shrink-0">{@render header()}</div>
  {/if}
  {#if children}
    <div class="min-h-0 min-w-0 flex-1">{@render children()}</div>
  {/if}
  {#if footer}
    <div class="mt-2.5 shrink-0">{@render footer()}</div>
  {/if}
</div>
