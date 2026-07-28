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
    ? `inline-flex items-center gap-0.5 rounded-lg bg-black/25 p-0.5 text-[12px] font-medium ring-1 ring-white/8 ${className}`
    : `flex items-stretch gap-0.5 border-b border-border-subtle text-[12px] font-medium ${className}`}
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
        ? `rounded-md px-3 py-1 transition-colors duration-100 disabled:opacity-40 ${
            value === item.id
              ? 'bg-studio-card text-studio-text shadow-sm ring-1 ring-white/10'
              : 'text-studio-text-dim hover:text-studio-text'
          }`
        : `border-b-2 px-3 py-2 transition-colors duration-100 disabled:opacity-40 ${
            value === item.id
              ? 'border-studio-purple text-studio-text'
              : 'border-transparent text-studio-text-dim hover:text-studio-text'
          }`}
      onclick={() => select(item.id, item.disabled)}
    >
      {item.label}
    </button>
  {/each}
</div>
