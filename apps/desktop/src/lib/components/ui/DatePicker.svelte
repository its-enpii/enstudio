<script lang="ts">
  /** value: ISO date `YYYY-MM-DD` or empty string */
  let {
    value = $bindable(''),
    label = '',
    hint = '',
    error = '',
    disabled = false,
    class: className = '',
  }: {
    value?: string
    label?: string
    hint?: string
    error?: string
    disabled?: boolean
    class?: string
  } = $props()

  let open = $state(false)
  let rootEl: HTMLDivElement | undefined = $state()
  let triggerEl: HTMLButtonElement | undefined = $state()
  let panelEl: HTMLDivElement | undefined = $state()
  let view = $state(new Date())
  let panelStyle = $state('')

  const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const PANEL_W = 280
  const PANEL_H = 320

  function parseISO(s: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(y!, m! - 1, d!)
    return Number.isNaN(dt.getTime()) ? null : dt
  }

  function toISO(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    )
  }

  const selected = $derived(parseISO(value))
  const display = $derived(
    selected
      ? selected.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '',
  )

  const monthLabel = $derived(
    view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  )

  type Cell = { date: Date; inMonth: boolean }
  const cells = $derived.by((): Cell[] => {
    const y = view.getFullYear()
    const m = view.getMonth()
    const first = new Date(y, m, 1)
    const startPad = first.getDay()
    const start = new Date(y, m, 1 - startPad)
    const out: Cell[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      out.push({ date: d, inMonth: d.getMonth() === m })
    }
    return out
  })

  function placePanel(): void {
    if (!triggerEl) return
    const r = triggerEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 6
    let top = r.bottom + gap
    let left = r.left
    if (top + PANEL_H > vh - 8 && r.top - gap - PANEL_H > 8) {
      top = r.top - gap - PANEL_H
    }
    if (left + PANEL_W > vw - 8) left = Math.max(8, vw - PANEL_W - 8)
    if (left < 8) left = 8
    if (top + PANEL_H > vh - 8) top = Math.max(8, vh - PANEL_H - 8)
    if (top < 8) top = 8
    panelStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;width:${PANEL_W}px`
  }

  function openCal(): void {
    if (disabled) return
    if (open) {
      open = false
      return
    }
    const base = selected ?? new Date()
    view = new Date(base.getFullYear(), base.getMonth(), 1)
    open = true
    queueMicrotask(placePanel)
  }

  function pick(d: Date): void {
    value = toISO(d)
    open = false
  }

  function shiftMonth(delta: number): void {
    view = new Date(view.getFullYear(), view.getMonth() + delta, 1)
  }

  function onDoc(e: MouseEvent): void {
    if (!open) return
    const t = e.target as Node
    if (rootEl?.contains(t) || panelEl?.contains(t)) return
    open = false
  }

  function onScrollOrResize(): void {
    if (open) placePanel()
  }

  const today = new Date()
</script>

<svelte:window onclick={onDoc} onscroll={onScrollOrResize} onresize={onScrollOrResize} />

<div class="relative flex min-w-0 flex-col gap-1.5 {className}" bind:this={rootEl}>
  {#if label}
    <span class="text-xs font-medium text-studio-text-dim">{label}</span>
  {/if}

  <button
    type="button"
    class="flex min-h-[38px] w-full items-center justify-between gap-2 rounded-sm border bg-studio-dark px-3 py-2 text-[13px] text-studio-text hover:border-studio-purple/35 disabled:opacity-50 {error
      ? 'border-danger/45'
      : open
        ? 'border-studio-purple/70'
        : 'border-border-subtle'}"
    bind:this={triggerEl}
    {disabled}
    onclick={(e) => {
      e.stopPropagation()
      openCal()
    }}
  >
    <span class={display ? '' : 'text-studio-text-dim/55'}>{display || 'Pick a date'}</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="text-studio-text-dim">
      <path
        d="M8 7V3m8 4V3M3 11h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed z-[200] rounded-md border border-studio-purple/35 bg-studio-card p-3 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
      role="dialog"
      aria-label="Calendar"
      tabindex="-1"
      bind:this={panelEl}
      style={panelStyle}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="mb-2.5 flex items-center justify-between">
        <button
          type="button"
          class="grid size-7 place-items-center rounded-sm text-lg leading-none text-studio-text-dim hover:bg-white/6 hover:text-white"
          onclick={() => shiftMonth(-1)}
          aria-label="Previous month">‹</button
        >
        <span class="text-[13px] font-semibold text-studio-text">{monthLabel}</span>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-sm text-lg leading-none text-studio-text-dim hover:bg-white/6 hover:text-white"
          onclick={() => shiftMonth(1)}
          aria-label="Next month">›</button
        >
      </div>
      <div class="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-studio-text-dim">
        {#each WEEK as w}
          <span>{w}</span>
        {/each}
      </div>
      <div class="grid grid-cols-7 gap-0.5">
        {#each cells as c}
          <button
            type="button"
            class="aspect-square rounded-sm text-xs tabular-nums hover:bg-studio-purple/25 {!c.inMonth
              ? 'text-studio-text-dim/40'
              : 'text-studio-text'} {selected && sameDay(c.date, selected)
              ? 'bg-studio-purple text-white hover:bg-studio-purple'
              : ''} {sameDay(c.date, today) && !(selected && sameDay(c.date, selected))
              ? 'shadow-[inset_0_0_0_1px_rgba(230,175,46,0.55)]'
              : ''}"
            onclick={() => pick(c.date)}
          >
            {c.date.getDate()}
          </button>
        {/each}
      </div>
      <div class="mt-2 flex justify-between border-t border-border-subtle pt-2">
        <button
          type="button"
          class="rounded px-1.5 py-1 text-[11px] text-studio-text-dim hover:bg-white/5 hover:text-white"
          onclick={() => {
            value = ''
            open = false
          }}>Clear</button
        >
        <button
          type="button"
          class="rounded px-1.5 py-1 text-[11px] text-studio-text-dim hover:bg-white/5 hover:text-white"
          onclick={() => pick(new Date())}>Today</button
        >
      </div>
    </div>
  {/if}

  {#if error}
    <span class="text-[11px] text-danger">{error}</span>
  {:else if hint}
    <span class="text-[11px] text-studio-text-dim">{hint}</span>
  {/if}
</div>
