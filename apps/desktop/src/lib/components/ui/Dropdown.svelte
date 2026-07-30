<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Icon } from '../../icons'
  import { layoutRect, layoutViewport } from '../../domZoom'

  export type DropdownItem = {
    id: string
    label: string
    description?: string
    disabled?: boolean
    danger?: boolean
    separator?: boolean
  }

  let {
    items = [],
    label = '',
    disabled = false,
    align = 'start',
    onSelect,
    class: className = '',
    trigger,
  }: {
    items?: DropdownItem[]
    label?: string
    disabled?: boolean
    align?: 'start' | 'end'
    onSelect?: (id: string) => void
    class?: string
    /** Custom trigger; default is a ghost button with `label`. */
    trigger?: Snippet<[{ open: boolean; toggle: () => void }]>
  } = $props()

  let open = $state(false)
  let rootEl: HTMLDivElement | undefined = $state()
  let triggerEl: HTMLElement | undefined = $state()
  let menuEl: HTMLDivElement | undefined = $state()
  let activeIdx = $state(-1)
  let menuStyle = $state('')

  const actionable = $derived(
    items.map((it, i) => ({ it, i })).filter((x) => !x.it.separator && !x.it.disabled),
  )

  function placeMenu(): void {
    if (!triggerEl) return
    // CSS zoom on <html> → convert visual rect to layout coords for position:fixed.
    const r = layoutRect(triggerEl)
    const { width: vw, height: vh } = layoutViewport()
    const gap = 4
    const maxH = 280
    let top = r.bottom + gap
    let width = Math.max(r.width, 180)
    let left = align === 'end' ? r.right - width : r.left
    if (top + maxH > vh - 8 && r.top - gap - maxH > 8) top = r.top - gap - maxH
    if (left + width > vw - 8) left = Math.max(8, vw - width - 8)
    if (left < 8) left = 8
    if (top < 8) top = 8
    menuStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;min-width:${Math.round(width)}px;max-height:${maxH}px`
  }

  function close(): void {
    open = false
    activeIdx = -1
  }

  function toggle(): void {
    if (disabled) return
    open = !open
    if (open) {
      activeIdx = actionable[0]?.i ?? -1
      queueMicrotask(() => {
        placeMenu()
        menuEl?.focus()
      })
    }
  }

  function pick(item: DropdownItem): void {
    if (item.disabled || item.separator) return
    onSelect?.(item.id)
    close()
  }

  function onDoc(e: MouseEvent): void {
    if (!open) return
    const t = e.target as Node
    if (rootEl?.contains(t) || menuEl?.contains(t)) return
    close()
  }

  function onScrollOrResize(): void {
    if (open) placeMenu()
  }

  function onMenuKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!actionable.length) return
      const cur = actionable.findIndex((x) => x.i === activeIdx)
      const next =
        e.key === 'ArrowDown'
          ? actionable[(cur + 1) % actionable.length]!
          : actionable[(cur - 1 + actionable.length) % actionable.length]!
      activeIdx = next.i
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const item = items[activeIdx]
      if (item) pick(item)
    }
  }
</script>

<svelte:window onclick={onDoc} onscroll={onScrollOrResize} onresize={onScrollOrResize} />

<div class="relative inline-flex {className}" bind:this={rootEl}>
  <div class="inline-flex" bind:this={triggerEl}>
    {#if trigger}
      {@render trigger({ open, toggle })}
    {:else}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-sm border border-border-subtle bg-studio-dark px-3 py-1.5 text-[13px] text-studio-text hover:border-studio-purple/35 disabled:opacity-50"
        {disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onclick={(e) => {
          e.stopPropagation()
          toggle()
        }}
      >
        <span>{label || 'Menu'}</span>
        <Icon
          name="chevron-down"
          size={14}
          class="text-studio-text-dim transition-transform {open ? 'rotate-180' : ''}"
        />
      </button>
    {/if}
  </div>

  {#if open}
    <div
      class="fixed z-[200] overflow-y-auto rounded-lg border border-border-subtle bg-studio-popover p-1 outline-none"
      role="menu"
      tabindex="-1"
      bind:this={menuEl}
      style={menuStyle}
      onkeydown={onMenuKey}
    >
      {#each items as item, i (item.id || `sep-${i}`)}
        {#if item.separator}
          <div class="my-1 h-px bg-border-subtle" role="separator"></div>
        {:else}
          <button
            type="button"
            class="flex w-full flex-col gap-0.5 rounded-sm px-2.5 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40 {item.danger
              ? 'text-danger'
              : 'text-studio-text'} {i === activeIdx ? 'bg-studio-purple/25' : 'hover:bg-studio-purple/25'}"
            role="menuitem"
            disabled={item.disabled}
            onmouseenter={() => (activeIdx = i)}
            onclick={() => pick(item)}
          >
            <span class="font-medium">{item.label}</span>
            {#if item.description}
              <span class="text-[11px] text-studio-text-dim">{item.description}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>
