<script lang="ts">
  import type { Snippet } from 'svelte'

  type Tone = 'neutral' | 'purple' | 'gold' | 'success' | 'danger'

  let {
    tone = 'neutral',
    class: className = '',
    children,
  }: {
    tone?: Tone
    class?: string
    children?: Snippet
  } = $props()

  const tones: Record<Tone, string> = {
    neutral: 'bg-white/6 text-studio-text-dim border-white/10',
    purple: 'bg-studio-purple/20 text-studio-lavender-bright border-studio-purple/35',
    gold: 'bg-studio-gold/15 text-studio-gold border-studio-gold/35',
    success: 'bg-studio-success/12 text-studio-success-bright border-studio-success/30',
    danger: 'bg-danger-bg text-danger border-danger/30',
  }
</script>

<span
  class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] {tones[tone]} {className}"
>
  {#if children}{@render children()}{/if}
</span>
