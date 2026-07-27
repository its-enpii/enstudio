<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
  type Size = 'sm' | 'md'

  let {
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    class: className = '',
    children,
    onclick,
    ...rest
  }: {
    variant?: Variant
    size?: Size
    type?: HTMLButtonAttributes['type']
    disabled?: boolean
    loading?: boolean
    class?: string
    children?: Snippet
    onclick?: HTMLButtonAttributes['onclick']
  } & Omit<HTMLButtonAttributes, 'type' | 'disabled' | 'onclick' | 'class'> = $props()
</script>

<button
  class="ui-btn ui-btn-{variant} ui-btn-{size} {className}"
  {type}
  disabled={disabled || loading}
  {onclick}
  {...rest}
>
  {#if loading}
    <span class="ui-btn-spin" aria-hidden="true"></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>

<style>
  .ui-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 8px;
    font-weight: 500;
    border: 1px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    transition:
      filter 0.12s,
      background 0.12s,
      border-color 0.12s,
      color 0.12s;
  }
  .ui-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ui-btn-sm {
    font-size: 11px;
    padding: 4px 10px;
  }
  .ui-btn-md {
    font-size: 13px;
    padding: 8px 16px;
  }
  .ui-btn-primary {
    background: var(--studio-purple);
    color: #fff;
  }
  .ui-btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .ui-btn-secondary {
    background: transparent;
    color: var(--studio-text);
    border-color: rgba(61, 52, 139, 0.45);
  }
  .ui-btn-secondary:hover:not(:disabled) {
    border-color: rgba(61, 52, 139, 0.8);
    background: rgba(61, 52, 139, 0.12);
  }
  .ui-btn-ghost {
    background: transparent;
    color: var(--studio-text-dim);
  }
  .ui-btn-ghost:hover:not(:disabled) {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
  }
  .ui-btn-danger {
    background: rgba(147, 0, 10, 0.35);
    color: #ffb4ab;
    border-color: rgba(255, 180, 171, 0.25);
  }
  .ui-btn-danger:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .ui-btn-spin {
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 999px;
    animation: ui-spin 0.7s linear infinite;
  }
  @keyframes ui-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
