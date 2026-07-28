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
    neutral: 'bg-white/[0.05] text-studio-text-dim border-border-subtle',
    purple: 'bg-studio-purple/15 text-studio-lavender-bright border-studio-purple/30',
    gold: 'bg-studio-gold/12 text-studio-gold border-studio-gold/30',
    success: 'bg-studio-success/12 text-studio-success-bright border-studio-success/25',
    danger: 'bg-danger-bg text-danger border-danger/25',
  }
</script>

<span
  class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide {tones[tone]} {className}"
>
  {#if children}{@render children()}{/if}
</span>
