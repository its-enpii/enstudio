<script lang="ts">
  import { Icon } from '../../icons'
  import { layoutRect, layoutViewport } from '../../domZoom'

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
    searchPlaceholder = 'Search…',
    searchable = false,
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
    searchPlaceholder?: string
    /** Show filter input in menu. Auto-on when options.length > 8 if omitted false only when explicit. */
    searchable?: boolean
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
  let searchEl: HTMLInputElement | undefined = $state()
  let activeIdx = $state(-1)
  let menuStyle = $state('')
  let query = $state('')

  const showSearch = $derived(searchable || options.length > 8)
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.description?.toLowerCase().includes(q) ?? false),
    )
  })
  const selected = $derived(options.find((o) => o.value === value))
  const enabled = $derived(filtered.map((o, i) => ({ o, i })).filter((x) => !x.o.disabled))

  function placeMenu(): void {
    if (!triggerEl) return
    // CSS zoom on <html> → convert visual rect to layout coords for position:fixed.
    const r = layoutRect(triggerEl)
    const { width: vw, height: vh } = layoutViewport()
    const gap = 4
    const searchH = showSearch ? 40 : 0
    const estH = Math.min(320, filtered.length * 44 + 8 + searchH)
    const spaceBelow = vh - r.bottom - 8
    const spaceAbove = r.top - 8
    // Flip up when not enough room below (composer sits at bottom)
    const openAbove = spaceBelow < Math.min(estH, 160) && spaceAbove > spaceBelow
    let left = r.left
    let width = Math.max(r.width, 200)
    if (left + width > vw - 8) left = Math.max(8, vw - width - 8)
    if (left < 8) left = 8
    if (openAbove) {
      // Anchor bottom edge to trigger top — no phantom gap from max-height
      const bottom = vh - r.top + gap
      const maxH = Math.min(320, spaceAbove - gap)
      menuStyle = `bottom:${Math.round(bottom)}px;left:${Math.round(left)}px;width:${Math.round(width)}px;max-height:${Math.round(maxH)}px;top:auto`
    } else {
      const top = Math.max(8, r.bottom + gap)
      const maxH = Math.min(320, spaceBelow - gap)
      menuStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;width:${Math.round(width)}px;max-height:${Math.round(maxH)}px;bottom:auto`
    }
  }

  function close(): void {
    open = false
    activeIdx = -1
    query = ''
  }

  function toggle(): void {
    if (disabled) return
    open = !open
    if (open) {
      const idx = filtered.findIndex((o) => o.value === value)
      activeIdx = idx >= 0 ? idx : enabled[0]?.i ?? -1
      queueMicrotask(() => {
        placeMenu()
        if (showSearch) searchEl?.focus()
        else listEl?.focus()
      })
    } else {
      query = ''
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

  function moveActive(dir: 1 | -1): void {
    if (!enabled.length) return
    const cur = enabled.findIndex((x) => x.i === activeIdx)
    const next =
      dir === 1
        ? enabled[(cur + 1) % enabled.length]!
        : enabled[(cur - 1 + enabled.length) % enabled.length]!
    activeIdx = next.i
  }

  function onListKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveActive(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(-1)
      return
    }
    if (e.key === 'Enter' || (e.key === ' ' && !showSearch)) {
      e.preventDefault()
      const opt = filtered[activeIdx]
      if (opt) pick(opt)
    }
  }

  function onSearchInput(): void {
    activeIdx = enabled[0]?.i ?? -1
    placeMenu()
  }
</script>

<svelte:window onclick={onDoc} onscroll={onScrollOrResize} onresize={onScrollOrResize} />

<div class="relative flex min-w-0 flex-col gap-1.5 {className}" bind:this={rootEl}>
  {#if label}
    <span class="text-xs font-medium text-studio-text-dim" id="{label}-lbl">{label}</span>
  {/if}

  <button
    type="button"
    class="flex min-h-[38px] w-full items-center justify-between gap-2 rounded-sm border bg-studio-dark px-3 py-2 text-left text-[13px] text-studio-text hover:border-studio-purple/35 focus-visible:border-studio-purple/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-gold/50 disabled:cursor-not-allowed disabled:opacity-50 {error
      ? 'border-danger/45'
      : open
        ? 'border-studio-purple/70'
        : 'border-border-subtle'}"
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
    <span class="truncate {selected ? '' : 'text-studio-text-dim/55'}">
      {selected?.label ?? placeholder}
    </span>
    <Icon
      name="chevron-down"
      size={14}
      class="shrink-0 text-studio-text-dim transition-transform duration-150 {open ? 'rotate-180' : ''}"
    />
  </button>

  {#if open}
    <div
      class="fixed z-[200] flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-studio-popover outline-none"
      role="listbox"
      tabindex="-1"
      bind:this={listEl}
      style={menuStyle}
      onkeydown={onListKey}
    >
      {#if showSearch}
        <div class="shrink-0 border-b border-border-subtle p-1.5">
          <input
            bind:this={searchEl}
            class="w-full rounded-sm border border-border-subtle bg-studio-dark px-2.5 py-1.5 text-[12px] text-studio-text outline-none placeholder:text-studio-text-dim/50 focus:border-studio-purple/60"
            type="text"
            placeholder={searchPlaceholder}
            bind:value={query}
            oninput={onSearchInput}
            onkeydown={onListKey}
            aria-label={searchPlaceholder}
          />
        </div>
      {/if}
      <div class="min-h-0 flex-1 overflow-y-auto p-1">
        {#if filtered.length === 0}
          <div class="px-2.5 py-3 text-center text-[12px] text-studio-text-dim">No matches</div>
        {:else}
          {#each filtered as opt, i (opt.value)}
            {@const selected = opt.value === value}
            {@const active = i === activeIdx}
            <button
              type="button"
              class="flex w-full flex-col gap-0 rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40 {selected
                ? 'bg-studio-purple/35 text-white'
                : active
                  ? 'bg-white/8 text-studio-text'
                  : 'text-studio-text hover:bg-white/6'}"
              role="option"
              aria-selected={selected}
              disabled={opt.disabled}
              onmouseenter={() => (activeIdx = i)}
              onclick={() => pick(opt)}
            >
              <span class="font-medium leading-snug">{opt.label}</span>
              {#if opt.description}
                <span class="text-[11px] leading-snug {selected ? 'text-white/65' : 'text-studio-text-dim'}">{opt.description}</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  {#if error}
    <span class="text-[11px] text-danger">{error}</span>
  {:else if hint}
    <span class="text-[11px] text-studio-text-dim">{hint}</span>
  {/if}
</div>
