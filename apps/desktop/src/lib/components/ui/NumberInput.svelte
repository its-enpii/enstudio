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

<label class="ui-field {className}" class:has-error={Boolean(error)}>
  {#if label}
    <span class="ui-label">{label}</span>
  {/if}
  <div class="ui-number">
    <input
      class="ui-control"
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
    <div class="ui-number-btns">
      <button type="button" class="spin" tabindex="-1" {disabled} onclick={() => bump(1)} aria-label="Increment"
        >▲</button
      >
      <button type="button" class="spin" tabindex="-1" {disabled} onclick={() => bump(-1)} aria-label="Decrement"
        >▼</button
      >
    </div>
  </div>
  {#if error}
    <span class="ui-hint err">{error}</span>
  {:else if hint}
    <span class="ui-hint">{hint}</span>
  {/if}
</label>

<style>
  .ui-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .ui-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--studio-text-dim);
  }
  .ui-number {
    position: relative;
    display: flex;
    align-items: stretch;
  }
  .ui-control {
    width: 100%;
    background: var(--studio-dark);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px 36px 8px 12px;
    font-size: 13px;
    color: var(--studio-text);
    outline: none;
    font-variant-numeric: tabular-nums;
  }
  .ui-control:hover:not(:disabled) {
    border-color: rgba(61, 52, 139, 0.35);
  }
  .ui-control:focus {
    border-color: rgba(61, 52, 139, 0.7);
  }
  .ui-control:disabled {
    opacity: 0.5;
  }
  .ui-number-btns {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .spin {
    width: 22px;
    height: 14px;
    font-size: 7px;
    line-height: 1;
    color: var(--studio-text-dim);
    border-radius: 4px;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .spin:hover:not(:disabled) {
    color: #fff;
    background: rgba(255, 255, 255, 0.06);
  }
  .ui-hint {
    font-size: 11px;
    color: var(--studio-text-dim);
  }
  .ui-hint.err {
    color: #ffb4ab;
  }
  .has-error .ui-control {
    border-color: rgba(255, 180, 171, 0.45);
  }
</style>
