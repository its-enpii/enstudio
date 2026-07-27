<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  let {
    value = $bindable<number | null>(null),
    label = '',
    hint = '',
    error = '',
    min = undefined,
    max = undefined,
    step = 1,
    placeholder = '',
    disabled = false,
    id = undefined,
    class: className = '',
    ...rest
  }: {
    value?: number | null
    label?: string
    hint?: string
    error?: string
    min?: number
    max?: number
    step?: number
    placeholder?: string
    disabled?: boolean
    id?: string
    class?: string
  } & Omit<HTMLInputAttributes, 'type' | 'value' | 'class' | 'min' | 'max' | 'step'> = $props()

  const inputId = $derived(id ?? (label ? `ni-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined))

  let text = $state(value == null || Number.isNaN(value) ? '' : String(value))

  $effect(() => {
    const next = value == null || Number.isNaN(value) ? '' : String(value)
    if (next !== text && document.activeElement?.id !== inputId) {
      text = next
    }
  })

  function commit(raw: string): void {
    if (raw.trim() === '') {
      value = null
      return
    }
    const n = Number(raw)
    if (Number.isNaN(n)) return
    let v = n
    if (min != null && v < min) v = min
    if (max != null && v > max) v = max
    value = v
    text = String(v)
  }

  function bump(dir: 1 | -1): void {
    if (disabled) return
    const base = value ?? 0
    let next = base + dir * step
    if (min != null && next < min) next = min
    if (max != null && next > max) next = max
    value = next
    text = String(next)
  }
</script>

<label class="flex min-w-0 flex-col gap-1.5 {className}">
  {#if label}
    <span class="text-xs font-medium text-studio-text-dim">{label}</span>
  {/if}
  <div class="relative flex items-stretch">
    <input
      class="w-full rounded-sm border bg-studio-dark py-2 pl-3 pr-9 text-[13px] text-studio-text tabular-nums outline-none hover:border-studio-purple/35 focus:border-studio-purple/70 disabled:opacity-50 {error
        ? 'border-danger/45'
        : 'border-border-subtle'}"
      type="text"
      inputmode="decimal"
      id={inputId}
      bind:value={text}
      {placeholder}
      {disabled}
      onblur={() => commit(text)}
      onkeydown={(e) => {
        if (e.key === 'Enter') commit(text)
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          bump(1)
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          bump(-1)
        }
      }}
      {...rest}
    />
    <div class="absolute right-1 top-1/2 flex -translate-y-1/2 flex-col gap-px">
      <button
        type="button"
        class="grid h-3.5 w-[22px] place-items-center rounded p-0 text-[7px] leading-none text-studio-text-dim hover:bg-white/6 hover:text-white"
        tabindex="-1"
        {disabled}
        onclick={() => bump(1)}
        aria-label="Increment">▲</button
      >
      <button
        type="button"
        class="grid h-3.5 w-[22px] place-items-center rounded p-0 text-[7px] leading-none text-studio-text-dim hover:bg-white/6 hover:text-white"
        tabindex="-1"
        {disabled}
        onclick={() => bump(-1)}
        aria-label="Decrement">▼</button
      >
    </div>
  </div>
  {#if error}
    <span class="text-[11px] text-danger">{error}</span>
  {:else if hint}
    <span class="text-[11px] text-studio-text-dim">{hint}</span>
  {/if}
</label>
