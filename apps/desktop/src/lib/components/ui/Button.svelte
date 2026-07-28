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
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium border border-transparent whitespace-nowrap transition-[filter,background,border-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-gold/50'
  const sizes: Record<Size, string> = {
    sm: 'text-[11px] px-3 py-1.5',
    md: 'text-[13px] px-4 py-2',
  }
  const variants: Record<Variant, string> = {
    primary:
      'bg-studio-purple text-white hover:brightness-110 hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-studio-purple)_55%,transparent)] disabled:hover:brightness-100 disabled:hover:shadow-none',
    secondary:
      'bg-transparent text-studio-text border-studio-purple/35 hover:border-studio-purple/70 hover:bg-studio-purple/12',
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
      class="size-3 rounded-lg border-2 border-current border-r-transparent animate-spin"
      aria-hidden="true"
    ></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>
