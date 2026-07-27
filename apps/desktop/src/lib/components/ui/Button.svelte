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
    'inline-flex items-center justify-center gap-2 rounded-sm font-medium border border-transparent whitespace-nowrap transition-[filter,background,border-color,color] duration-100'
  const sizes: Record<Size, string> = {
    sm: 'text-[11px] px-2.5 py-1',
    md: 'text-[13px] px-4 py-2',
  }
  const variants: Record<Variant, string> = {
    primary: 'bg-studio-purple text-white hover:brightness-110 disabled:hover:brightness-100',
    secondary:
      'bg-transparent text-studio-text border-studio-purple/45 hover:border-studio-purple/80 hover:bg-studio-purple/12',
    ghost: 'bg-transparent text-studio-text-dim hover:text-white hover:bg-white/5',
    danger: 'bg-danger-bg text-danger border-danger/25 hover:brightness-110',
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
