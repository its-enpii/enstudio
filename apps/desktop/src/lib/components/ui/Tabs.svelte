<script lang="ts">
  export type TabItem = {
    id: string
    label: string
    disabled?: boolean
  }

  let {
    value = $bindable(''),
    items = [],
    variant = 'pill',
    ariaLabel = 'Tabs',
    onChange,
    class: className = '',
  }: {
    value?: string
    items?: TabItem[]
    variant?: 'pill' | 'underline'
    ariaLabel?: string
    onChange?: (id: string) => void
    class?: string
  } = $props()

  function select(id: string, disabled?: boolean): void {
    if (disabled) return
    value = id
    onChange?.(id)
  }
</script>

<div
  class={variant === 'pill'
    ? `inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-black/30 p-1 text-xs font-medium ${className}`
    : `flex items-stretch gap-0.5 border-b border-white/5 text-xs font-medium ${className}`}
  role="tablist"
  aria-label={ariaLabel}
>
  {#each items as item (item.id)}
    <button
      type="button"
      role="tab"
      aria-selected={value === item.id}
      disabled={item.disabled}
      class={variant === 'pill'
        ? `rounded-lg px-4 py-1.5 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-gold/50 disabled:opacity-40 ${
            value === item.id
              ? 'bg-studio-purple text-white'
              : 'text-studio-text-dim hover:text-white'
          }`
        : `border-b-2 px-3 py-2 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-gold/50 disabled:opacity-40 ${
            value === item.id
              ? 'border-studio-purple text-white'
              : 'border-transparent text-studio-text-dim hover:text-white'
          }`}
      onclick={() => select(item.id, item.disabled)}
    >
      {item.label}
    </button>
  {/each}
</div>
