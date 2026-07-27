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

<label class="ui-field {className}" class:has-error={Boolean(error)}>
  {#if label}
    <span class="ui-label">{label}</span>
  {/if}
  <input
    class="ui-control"
    {type}
    id={inputId}
    bind:value
    {placeholder}
    {disabled}
    {...rest}
  />
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
  .ui-control {
    width: 100%;
    background: var(--studio-dark);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--studio-text);
    outline: none;
  }
  .ui-control::placeholder {
    color: rgba(142, 142, 142, 0.55);
  }
  .ui-control:hover:not(:disabled) {
    border-color: rgba(61, 52, 139, 0.35);
  }
  .ui-control:focus {
    border-color: rgba(61, 52, 139, 0.7);
  }
  .ui-control:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ui-hint {
    font-size: 11px;
    color: var(--studio-text-dim);
  }
  .ui-hint.err,
  .has-error .ui-hint.err {
    color: #ffb4ab;
  }
  .has-error .ui-control {
    border-color: rgba(255, 180, 171, 0.45);
  }
</style>
