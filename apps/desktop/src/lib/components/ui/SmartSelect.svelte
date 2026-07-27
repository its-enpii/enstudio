<script lang="ts">
  export type SelectOption = {
    value: string
    label: string
    description?: string
    disabled?: boolean
  }

  let {
    value = $bindable(''),
    options = [],
    label = '',
    hint = '',
    error = '',
    placeholder = 'Select…',
    disabled = false,
    ariaLabel = '',
    title = '',
    onChange,
    class: className = '',
  }: {
    value?: string
    options?: SelectOption[]
    label?: string
    hint?: string
    error?: string
    placeholder?: string
    disabled?: boolean
    ariaLabel?: string
    title?: string
    onChange?: (value: string) => void
    class?: string
  } = $props()

  let open = $state(false)
  let rootEl: HTMLDivElement | undefined = $state()
  let triggerEl: HTMLButtonElement | undefined = $state()
  let listEl: HTMLDivElement | undefined = $state()
  let activeIdx = $state(-1)
  let menuStyle = $state('')

  const selected = $derived(options.find((o) => o.value === value))
  const enabled = $derived(options.map((o, i) => ({ o, i })).filter((x) => !x.o.disabled))

  function placeMenu(): void {
    if (!triggerEl) return
    const r = triggerEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 4
    const maxH = Math.min(280, options.length * 52 + 12)
    let top = r.bottom + gap
    let left = r.left
    let width = Math.max(r.width, 180)
    if (top + maxH > vh - 8 && r.top - gap - maxH > 8) {
      top = r.top - gap - maxH
    }
    if (left + width > vw - 8) left = Math.max(8, vw - width - 8)
    if (left < 8) left = 8
    if (top < 8) top = 8
    menuStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;width:${Math.round(width)}px;max-height:${Math.round(maxH)}px`
  }

  function close(): void {
    open = false
    activeIdx = -1
  }

  function toggle(): void {
    if (disabled) return
    open = !open
    if (open) {
      const idx = options.findIndex((o) => o.value === value)
      activeIdx = idx >= 0 ? idx : enabled[0]?.i ?? -1
      queueMicrotask(() => {
        placeMenu()
        listEl?.focus()
      })
    }
  }

  function pick(opt: SelectOption): void {
    if (opt.disabled) return
    value = opt.value
    onChange?.(opt.value)
    close()
  }

  function onDoc(e: MouseEvent): void {
    if (!open) return
    const t = e.target as Node
    if (rootEl?.contains(t) || listEl?.contains(t)) return
    close()
  }

  function onScrollOrResize(): void {
    if (open) placeMenu()
  }

  function onListKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!enabled.length) return
      const cur = enabled.findIndex((x) => x.i === activeIdx)
      const next =
        e.key === 'ArrowDown'
          ? enabled[(cur + 1) % enabled.length]!
          : enabled[(cur - 1 + enabled.length) % enabled.length]!
      activeIdx = next.i
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[activeIdx]
      if (opt) pick(opt)
    }
  }
</script>

<svelte:window
  onclick={onDoc}
  onscroll={onScrollOrResize}
  onresize={onScrollOrResize}
/>

<div class="ui-field {className}" class:has-error={Boolean(error)} class:is-open={open} bind:this={rootEl}>
  {#if label}
    <span class="ui-label" id="{label}-lbl">{label}</span>
  {/if}

  <button
    type="button"
    class="ui-select-trigger"
    bind:this={triggerEl}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel || undefined}
    {title}
    aria-labelledby={label ? `${label}-lbl` : undefined}
    onclick={(e) => {
      e.stopPropagation()
      toggle()
    }}
  >
    <span class="ui-select-value" class:placeholder={!selected}>
      {selected?.label ?? placeholder}
    </span>
    <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  {#if open}
    <div
      class="ui-select-menu"
      role="listbox"
      tabindex="-1"
      bind:this={listEl}
      style={menuStyle}
      onkeydown={onListKey}
    >
      {#each options as opt, i (opt.value)}
        <button
          type="button"
          class="ui-select-option"
          class:active={i === activeIdx}
          class:selected={opt.value === value}
          role="option"
          aria-selected={opt.value === value}
          disabled={opt.disabled}
          onmouseenter={() => (activeIdx = i)}
          onclick={() => pick(opt)}
        >
          <span class="opt-label">{opt.label}</span>
          {#if opt.description}
            <span class="opt-desc">{opt.description}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if error}
    <span class="ui-hint err">{error}</span>
  {:else if hint}
    <span class="ui-hint">{hint}</span>
  {/if}
</div>

<style>
  .ui-field {
    position: relative;
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
  .ui-select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 38px;
    text-align: left;
    background: var(--studio-dark);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--studio-text);
  }
  .ui-select-trigger:hover:not(:disabled) {
    border-color: rgba(61, 52, 139, 0.35);
  }
  .ui-select-trigger:focus-visible {
    outline: none;
    border-color: rgba(61, 52, 139, 0.7);
  }
  .ui-select-trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .is-open .ui-select-trigger {
    border-color: rgba(61, 52, 139, 0.7);
  }
  .ui-select-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ui-select-value.placeholder {
    color: rgba(142, 142, 142, 0.55);
  }
  .chev {
    flex-shrink: 0;
    color: var(--studio-text-dim);
    transition: transform 0.15s;
  }
  .is-open .chev {
    transform: rotate(180deg);
  }
  .ui-select-menu {
    position: fixed;
    z-index: 200;
    overflow-y: auto;
    background: #141414;
    border: 1px solid rgba(61, 52, 139, 0.35);
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    outline: none;
  }
  .ui-select-option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 13px;
    color: var(--studio-text);
    background: transparent;
  }
  .ui-select-option:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ui-select-option.active,
  .ui-select-option:hover:not(:disabled) {
    background: rgba(61, 52, 139, 0.25);
  }
  .ui-select-option.selected {
    color: #fff;
  }
  .opt-label {
    font-weight: 500;
  }
  .opt-desc {
    font-size: 11px;
    color: var(--studio-text-dim);
  }
  .ui-hint {
    font-size: 11px;
    color: var(--studio-text-dim);
  }
  .ui-hint.err {
    color: #ffb4ab;
  }
  .has-error .ui-select-trigger {
    border-color: rgba(255, 180, 171, 0.45);
  }
</style>
