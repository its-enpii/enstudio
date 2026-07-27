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
    // flip up if not enough space below
    if (top + PANEL_H > vh - 8 && r.top - gap - PANEL_H > 8) {
      top = r.top - gap - PANEL_H
    }
    // clamp horizontal
    if (left + PANEL_W > vw - 8) left = Math.max(8, vw - PANEL_W - 8)
    if (left < 8) left = 8
    // final vertical clamp
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

<svelte:window
  onclick={onDoc}
  onscroll={onScrollOrResize}
  onresize={onScrollOrResize}
/>

<div class="ui-field {className}" class:has-error={Boolean(error)} class:is-open={open} bind:this={rootEl}>
  {#if label}
    <span class="ui-label">{label}</span>
  {/if}

  <button
    type="button"
    class="ui-date-trigger"
    bind:this={triggerEl}
    {disabled}
    onclick={(e) => {
      e.stopPropagation()
      openCal()
    }}
  >
    <span class="val" class:placeholder={!display}>{display || 'Pick a date'}</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
      class="ui-cal"
      role="dialog"
      aria-label="Calendar"
      tabindex="-1"
      bind:this={panelEl}
      style={panelStyle}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="ui-cal-head">
        <button type="button" class="nav" onclick={() => shiftMonth(-1)} aria-label="Previous month"
          >‹</button
        >
        <span class="month">{monthLabel}</span>
        <button type="button" class="nav" onclick={() => shiftMonth(1)} aria-label="Next month"
          >›</button
        >
      </div>
      <div class="ui-cal-week">
        {#each WEEK as w}
          <span>{w}</span>
        {/each}
      </div>
      <div class="ui-cal-grid">
        {#each cells as c}
          <button
            type="button"
            class="day"
            class:out={!c.inMonth}
            class:today={sameDay(c.date, today)}
            class:sel={selected && sameDay(c.date, selected)}
            onclick={() => pick(c.date)}
          >
            {c.date.getDate()}
          </button>
        {/each}
      </div>
      <div class="ui-cal-foot">
        <button
          type="button"
          class="link"
          onclick={() => {
            value = ''
            open = false
          }}>Clear</button
        >
        <button type="button" class="link" onclick={() => pick(new Date())}>Today</button>
      </div>
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
  .ui-date-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 38px;
    background: var(--studio-dark);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--studio-text);
  }
  .ui-date-trigger:hover:not(:disabled) {
    border-color: rgba(61, 52, 139, 0.35);
  }
  .ui-date-trigger:disabled {
    opacity: 0.5;
  }
  .is-open .ui-date-trigger {
    border-color: rgba(61, 52, 139, 0.7);
  }
  .val.placeholder {
    color: rgba(142, 142, 142, 0.55);
  }
  /* fixed — escapes overflow:auto ancestors */
  .ui-cal {
    position: fixed;
    z-index: 200;
    background: #141414;
    border: 1px solid rgba(61, 52, 139, 0.35);
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
  }
  .ui-cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .month {
    font-size: 13px;
    font-weight: 600;
  }
  .nav {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--studio-text-dim);
    font-size: 18px;
    line-height: 1;
  }
  .nav:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }
  .ui-cal-week {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 4px;
    text-align: center;
    font-size: 10px;
    color: var(--studio-text-dim);
    font-weight: 500;
  }
  .ui-cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .day {
    aspect-ratio: 1;
    border-radius: 8px;
    font-size: 12px;
    color: var(--studio-text);
    font-variant-numeric: tabular-nums;
  }
  .day:hover {
    background: rgba(61, 52, 139, 0.25);
  }
  .day.out {
    color: rgba(142, 142, 142, 0.4);
  }
  .day.today {
    box-shadow: inset 0 0 0 1px rgba(230, 175, 46, 0.55);
  }
  .day.sel {
    background: var(--studio-purple);
    color: #fff;
  }
  .ui-cal-foot {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
  }
  .link {
    font-size: 11px;
    color: var(--studio-text-dim);
    padding: 4px 6px;
    border-radius: 6px;
  }
  .link:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
  }
  .ui-hint {
    font-size: 11px;
    color: var(--studio-text-dim);
  }
  .ui-hint.err {
    color: #ffb4ab;
  }
  .has-error .ui-date-trigger {
    border-color: rgba(255, 180, 171, 0.45);
  }
</style>
