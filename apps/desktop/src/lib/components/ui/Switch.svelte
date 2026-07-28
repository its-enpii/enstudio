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
    ? 'h-[18px] w-8 peer-checked:[&>span]:translate-x-3.5'
    : 'h-[22px] w-10 peer-checked:[&>span]:translate-x-[18px]'
  const thumb = compact ? 'left-px top-px size-3.5' : 'left-0.5 top-0.5 size-4'
</script>

<div
  class="flex min-w-0 flex-col {compact ? 'gap-0' : 'gap-1.5'} {disabled
    ? 'pointer-events-none opacity-45'
    : ''} {className}"
>
  {#if !compact}
    {#if label}
      <label class="cursor-pointer text-xs font-medium leading-tight text-studio-text-dim" for={id}
        >{label}</label
      >
    {:else}
      <span class="invisible select-none text-xs font-medium leading-tight" aria-hidden="true"
        >&nbsp;</span
      >
    {/if}
  {/if}

  <label
    class="relative m-0 inline-flex max-w-full cursor-pointer select-none items-center {compact
      ? 'min-h-7 gap-2 py-1'
      : 'min-h-[38px] gap-3'}"
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
      class="pointer-events-none relative shrink-0 rounded-lg border border-border-subtle bg-white/8 transition-[background,border-color] duration-150 peer-checked:border-studio-purple/90 peer-checked:bg-studio-purple/85 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-studio-gold/50 peer-hover:border-studio-purple/45 {track}"
      aria-hidden="true"
    >
      <span class="absolute rounded-lg bg-studio-text transition-transform duration-150 {thumb}"
      ></span>
    </span>
    {#if description}
      <span
        class="pointer-events-none min-w-0 text-studio-text-dim {compact
          ? 'whitespace-nowrap text-[11px] leading-tight'
          : 'text-xs leading-snug'}">{description}</span
      >
    {/if}
  </label>
</div>
