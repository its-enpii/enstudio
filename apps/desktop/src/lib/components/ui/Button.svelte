<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
  type Size = 'sm' | 'md'

  let {
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    class: className = '',
    children,
    onclick,
    ...rest
  }: {
    variant?: Variant
    size?: Size
    type?: HTMLButtonAttributes['type']
    disabled?: boolean
    loading?: boolean
    class?: string
    children?: Snippet
    onclick?: HTMLButtonAttributes['onclick']
  } & Omit<HTMLButtonAttributes, 'type' | 'disabled' | 'onclick' | 'class'> = $props()

  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium border border-transparent whitespace-nowrap transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-gold/50'
  const sizes: Record<Size, string> = {
    sm: 'text-[12px] px-3 py-1.5 min-h-7',
    md: 'text-[13px] px-3.5 py-2 min-h-8',
  }
  const variants: Record<Variant, string> = {
    primary: 'bg-studio-purple text-white hover:bg-studio-purple-bright shadow-sm',
    secondary:
      'bg-white/[0.08] text-studio-text ring-1 ring-white/10 hover:bg-white/[0.12]',
    ghost: 'bg-transparent text-studio-text-dim hover:text-studio-text hover:bg-white/[0.06]',
    danger: 'bg-danger-bg text-danger ring-1 ring-danger/25 hover:bg-danger-bg',
  }
</script>

<button
  class="{base} {sizes[size]} {variants[variant]} {className}"
  {type}
  disabled={disabled || loading}
  {onclick}
  {...rest}
>
  {#if loading}
    <span
      class="size-3 rounded-full border-2 border-current border-r-transparent animate-spin"
      aria-hidden="true"
    ></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>
