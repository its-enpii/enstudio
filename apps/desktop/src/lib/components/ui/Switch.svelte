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
</script>

<div class="ui-field {className}" class:is-compact={compact} class:is-disabled={disabled}>
  {#if !compact}
    {#if label}
      <label class="ui-label" for={id}>{label}</label>
    {:else}
      <span class="ui-label ui-label-spacer" aria-hidden="true">&nbsp;</span>
    {/if}
  {/if}

  <label class="ui-switch-row" for={id}>
    <input
      {id}
      type="checkbox"
      role="switch"
      checked={checked}
      {disabled}
      aria-checked={checked}
      aria-label={label || description || 'Toggle'}
      onchange={onChange}
    />
    <span class="track" aria-hidden="true"><span class="thumb"></span></span>
    {#if description}
      <span class="desc">{description}</span>
    {/if}
  </label>
</div>

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
    line-height: 1.2;
    cursor: pointer;
  }
  .ui-label-spacer {
    visibility: hidden;
    user-select: none;
  }
  .ui-switch-row {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 38px;
    max-width: 100%;
    margin: 0;
    cursor: pointer;
    user-select: none;
  }
  .ui-switch-row input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 1;
  }
  .track {
    position: relative;
    flex-shrink: 0;
    width: 40px;
    height: 22px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--border-subtle);
    transition:
      background 0.15s,
      border-color 0.15s;
    pointer-events: none;
  }
  .ui-switch-row input:checked + .track {
    background: rgba(61, 52, 139, 0.85);
    border-color: rgba(61, 52, 139, 0.9);
  }
  .ui-switch-row:hover .track {
    border-color: rgba(61, 52, 139, 0.45);
  }
  .ui-switch-row input:focus-visible + .track {
    outline: 2px solid rgba(230, 175, 46, 0.5);
    outline-offset: 2px;
  }
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: #e2e2e2;
    transition: transform 0.15s;
  }
  .ui-switch-row input:checked + .track .thumb {
    transform: translateX(18px);
    background: #fff;
  }
  .is-disabled {
    opacity: 0.45;
    pointer-events: none;
  }
  .desc {
    font-size: 12px;
    color: var(--studio-text-dim);
    line-height: 1.35;
    min-width: 0;
    pointer-events: none;
  }

  .is-compact {
    gap: 0;
  }
  .is-compact .ui-switch-row {
    gap: 8px;
    min-height: 28px;
    padding: 4px 0;
  }
  .is-compact .track {
    width: 32px;
    height: 18px;
  }
  .is-compact .thumb {
    top: 1px;
    width: 14px;
    height: 14px;
  }
  .is-compact .ui-switch-row input:checked + .track .thumb {
    transform: translateX(14px);
  }
  .is-compact .desc {
    font-size: 11px;
    line-height: 1.2;
    white-space: nowrap;
  }
</style>
