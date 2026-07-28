<script lang="ts">
  let {
    checked = $bindable(false),
    label = '',
    description = '',
    disabled = false,
    compact = false,
    class: className = '',
  }: {
    checked?: boolean
    label?: string
    description?: string
    disabled?: boolean
    compact?: boolean
    class?: string
  } = $props()

  const id = `sw-${crypto.randomUUID()}`

  function onChange(event: Event): void {
    if (disabled) return
    checked = (event.currentTarget as HTMLInputElement).checked
  }

  const track = compact
    ? 'h-4 w-7 peer-checked:[&>span]:translate-x-3'
    : 'h-5 w-9 peer-checked:[&>span]:translate-x-4'
  const thumb = compact ? 'size-3' : 'size-4'
</script>

<div
  class="flex min-w-0 flex-col {compact ? 'gap-0' : 'gap-1'} {disabled
    ? 'pointer-events-none opacity-40'
    : ''} {className}"
>
  {#if !compact}
    {#if label}
      <label class="cursor-pointer text-[12px] font-medium text-studio-text-dim" for={id}>{label}</label>
    {:else}
      <span class="invisible select-none text-[12px]" aria-hidden="true">&nbsp;</span>
    {/if}
  {/if}

  <label
    class="relative m-0 inline-flex max-w-full cursor-pointer select-none items-center {compact
      ? 'min-h-6 gap-2 py-0.5'
      : 'min-h-8 gap-2.5'}"
    for={id}
  >
    <input
      {id}
      type="checkbox"
      role="switch"
      class="peer absolute inset-0 z-[1] m-0 h-full w-full cursor-pointer opacity-0"
      checked={checked}
      {disabled}
      aria-checked={checked}
      aria-label={label || description || 'Toggle'}
      onchange={onChange}
    />
    <span
      class="pointer-events-none relative flex shrink-0 items-center rounded-full border border-border-subtle bg-white/10 px-0.5 transition-colors duration-100 peer-checked:border-studio-purple peer-checked:bg-studio-purple {track}"
      aria-hidden="true"
    >
      <span class="rounded-full bg-white shadow-sm transition-transform duration-100 {thumb}"></span>
    </span>
    {#if description}
      <span
        class="pointer-events-none min-w-0 text-studio-text-dim {compact
          ? 'whitespace-nowrap text-[11px]'
          : 'text-[12px]'}">{description}</span
      >
    {/if}
  </label>
</div>
