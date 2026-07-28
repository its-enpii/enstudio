<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements'

  let {
    value = $bindable(''),
    label = '',
    hint = '',
    error = '',
    placeholder = '',
    disabled = false,
    rows = 3,
    id = undefined,
    class: className = '',
    ...rest
  }: {
    value?: string
    label?: string
    hint?: string
    error?: string
    placeholder?: string
    disabled?: boolean
    rows?: number
    id?: string
    class?: string
  } & Omit<HTMLTextareaAttributes, 'value' | 'class' | 'rows'> = $props()

  const inputId = $derived(id ?? (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined))
</script>

<label class="flex min-w-0 flex-col gap-1.5 {className}">
  {#if label}
    <span class="text-xs font-medium text-studio-text-dim">{label}</span>
  {/if}
  <textarea
    class="min-h-[56px] w-full resize-y rounded-md border bg-studio-dark px-2.5 py-1.5 text-[12px] text-studio-text outline-none placeholder:text-studio-text-dim/55 hover:border-white/12 focus:border-studio-purple/60 disabled:cursor-not-allowed disabled:opacity-50 {error
      ? 'border-danger/45'
      : 'border-border-subtle'}"
    id={inputId}
    bind:value
    {placeholder}
    {disabled}
    {rows}
    aria-invalid={error ? true : undefined}
    aria-describedby={error && inputId ? `${inputId}-err` : undefined}
    {...rest}
  ></textarea>
  {#if error}
    <span id={inputId ? `${inputId}-err` : undefined} class="text-[11px] text-danger" role="alert">{error}</span>
  {:else if hint}
    <span class="text-[11px] text-studio-text-dim">{hint}</span>
  {/if}
</label>
