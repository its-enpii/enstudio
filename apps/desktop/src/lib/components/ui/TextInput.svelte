<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  let {
    value = $bindable(''),
    label = '',
    hint = '',
    error = '',
    type = 'text',
    placeholder = '',
    disabled = false,
    id = undefined,
    class: className = '',
    ...rest
  }: {
    value?: string
    label?: string
    hint?: string
    error?: string
    type?: HTMLInputAttributes['type']
    placeholder?: string
    disabled?: boolean
    id?: string
    class?: string
  } & Omit<HTMLInputAttributes, 'type' | 'value' | 'class'> = $props()

  const inputId = $derived(id ?? (label ? `ti-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined))
</script>

<label class="flex min-w-0 flex-col gap-1.5 {className}">
  {#if label}
    <span class="text-xs font-medium text-studio-text-dim">{label}</span>
  {/if}
  <input
    class="min-h-[38px] w-full rounded-sm border bg-studio-dark px-3 py-2 text-[13px] text-studio-text outline-none placeholder:text-studio-text-dim/55 hover:border-studio-purple/35 focus:border-studio-purple/70 disabled:cursor-not-allowed disabled:opacity-50 {error
      ? 'border-danger/45'
      : 'border-border-subtle'}"
    {type}
    id={inputId}
    bind:value
    {placeholder}
    {disabled}
    aria-invalid={error ? true : undefined}
    aria-describedby={error && inputId ? `${inputId}-err` : undefined}
    {...rest}
  />
  {#if error}
    <span id={inputId ? `${inputId}-err` : undefined} class="text-[11px] text-danger" role="alert">{error}</span>
  {:else if hint}
    <span class="text-[11px] text-studio-text-dim">{hint}</span>
  {/if}
</label>
