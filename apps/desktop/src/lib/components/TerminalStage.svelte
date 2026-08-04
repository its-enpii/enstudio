<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { listSsh, type SshHostInfo } from '../enpii'
  import { state as app, fontStack, EDITOR_FONT_SIZE } from '../store.svelte'
  import { xtermTheme } from '../theme'
  import { Icon } from '../icons'
  import {
    applyMirrorData,
    commandToken,
    createMirror,
    ghostSuffix,
    isAltScreen,
    notePtyOutput,
    pickBestMatch,
    shouldShowGhost,
    type LineMirror,
  } from '../termGhost'

  type TerminalTab = { id: string; title: string; exited: boolean }
  type PaneIds = [string | null, string | null]
  type TerminalWorkspace = { tabs: TerminalTab[]; activeId: string | null; paneIds: PaneIds; paneTabs: [string[], string[]]; focusedPane: 0 | 1; nextTitle: number }
  type GhostState = {
    mirror: LineMirror
    suffix: string
    match: string | null
    matches: string[]
    menuOpen: boolean
    selected: number
    left: number
    top: number
    timer?: ReturnType<typeof setTimeout>
  }

  let tabs = $state<TerminalTab[]>([])
  let activeId = $state<string | null>(null)
  let paneIds = $state<PaneIds>([null, null])
  let paneTabs = $state<[string[], string[]]>([[], []])
  let focusedPane = $state<0 | 1>(0)
  let editingId = $state<string | null>(null)
  let editingTitle = $state('')
  let renameInput = $state<HTMLInputElement>()
  let primaryHost = $state<HTMLDivElement>()
  let secondaryHost = $state<HTMLDivElement>()
  /** Ghost UI for focused terminal (DOM overlay on pane). */
  let ghostText = $state('')
  let ghostLeft = $state(0)
  let ghostTop = $state(0)
  let ghostPane = $state<0 | 1>(0)
  let ghostMenuOpen = $state(false)
  let ghostMatches = $state<string[]>([])
  let ghostSelected = $state(0)
  let ghostVisible = $state(false)
  let error = $state('')
  let currentProjectId: string | null = null
  const workspaces = new Map<string, TerminalWorkspace>()
  let destroyed = false
  let resizeObserver: ResizeObserver | undefined
  const terminals = new Map<string, Terminal>()
  const fitAddons = new Map<string, FitAddon>()
  const terminalSizes = new Map<string, { cols: number; rows: number }>()
  const nudgedForFontKey = new Map<string, string>()
  const pendingData = new Map<string, string>()
  const creatingFor = new Set<string>()
  const ghosts = new Map<string, GhostState>()
  const api = window.enpiistudio.terminal

  function workspaceFor(projectId: string): TerminalWorkspace {
    const existing = workspaces.get(projectId)
    if (existing) return existing
    const workspace: TerminalWorkspace = { tabs: [], activeId: null, paneIds: [null, null], paneTabs: [[], []], focusedPane: 0, nextTitle: 1 }
    workspaces.set(projectId, workspace)
    return workspace
  }

  function syncWorkspace(): void {
    if (!currentProjectId) return
    const workspace = workspaceFor(currentProjectId)
    workspace.tabs = tabs
    workspace.activeId = activeId
    workspace.paneIds = [...paneIds]
    workspace.paneTabs = [ [...paneTabs[0]], [...paneTabs[1]] ]
    workspace.focusedPane = focusedPane
  }

  function normalizePaneState(preferredId?: string): void {
    const valid = new Set(tabs.map((tab) => tab.id))
    const knownPaneTabs = paneTabs[0].some((id) => valid.has(id)) || paneTabs[1].some((id) => valid.has(id))
    if (!knownPaneTabs && tabs.length) {
      paneTabs = [tabs.filter((tab) => tab.id !== paneIds[1]).map((tab) => tab.id), paneIds[1] ? [paneIds[1]] : []]
    } else {
      paneTabs = [
        [...new Set(paneTabs[0].filter((id) => valid.has(id)))],
        [...new Set(paneTabs[1].filter((id) => valid.has(id)))],
      ]
    }
    let next: PaneIds = [
      paneIds[0] && valid.has(paneIds[0]) ? paneIds[0] : null,
      paneIds[1] && valid.has(paneIds[1]) ? paneIds[1] : null,
    ]
    if (!next[0] && next[1]) next = [next[1], null]
    if (!next[0] && tabs.length) next = [preferredId && valid.has(preferredId) ? preferredId : tabs[0]!.id, null]
    paneIds = next
    for (const pane of [0, 1] as const) {
      const id = paneIds[pane]
      if (id && !paneTabs[pane].includes(id)) paneTabs[pane] = [...paneTabs[pane], id]
    }
    if (!paneIds[0]) {
      focusedPane = 0
      activeId = null
    } else if (!paneIds[focusedPane]) {
      focusedPane = 0
      activeId = paneIds[0]
    } else {
      activeId = paneIds[focusedPane]
    }
  }

  function hostForPane(pane: 0 | 1): HTMLDivElement | undefined {
    return pane === 0 ? primaryHost : secondaryHost
  }

  const resizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const readyHosts = new Set<HTMLDivElement>()

  function hostReady(host: HTMLDivElement | undefined): host is HTMLDivElement {
    return Boolean(host && host.clientWidth > 80 && host.clientHeight > 40)
  }

  function fitPane(pane: 0 | 1, immediate = false): void {
    const id = paneIds[pane]
    const host = hostForPane(pane)
    // Skip tiny/hidden hosts — fitting to ~20 cols wraps prompt then jumps (blink).
    if (!id || !hostReady(host)) return
    const fit = fitAddons.get(id)
    const terminal = terminals.get(id)
    if (!fit || !terminal) return
    const apply = () => {
      if (!hostReady(host)) return
      // Snapshot host box before fit — if it shifts before our size settles we
      // re-fit one more tick (webFrame zoom + font swap often change host size
      // mid-measurement, leaving the terminal cropped).
      const w0 = host.clientWidth
      const h0 = host.clientHeight
      const fontKey = `${fontStack(app.ui.fontFamily)}|${EDITOR_FONT_SIZE}|${app.ui.uiZoom}`
      // Force a re-measure when font/zoom has changed since the last successful
      // fit. xterm caches `_charSizeService` measurements and only re-measures
      // when buffer cols/rows differ — so without this nudge, a stale
      // (pre-font-load) cell.width keeps us locked at the wrong column count
      // and the terminal stays visibly cropped on the right edge.
      if (nudgedForFontKey.get(id) !== fontKey && terminal.cols > 0 && terminal.rows > 0) {
        nudgedForFontKey.set(id, fontKey)
        try {
          terminal.resize(Math.max(2, terminal.cols + 1), terminal.rows)
          terminal.resize(Math.max(2, terminal.cols - 1), terminal.rows)
        } catch {
          /* not yet mounted */
        }
      }
      try {
        // Validate before fit(): fit() mutates browser-side xterm immediately.
        // Returning afterward would leave xterm and node-pty at different sizes.
        const proposed = fit.proposeDimensions()
        if (!proposed || proposed.cols < 40 || proposed.rows < 10) return
        fit.fit()
        terminalSizes.set(id, { cols: terminal.cols, rows: terminal.rows })
        void api.resize(id, terminal.cols, terminal.rows)
        host.style.opacity = '1'
        readyHosts.add(host)
      } catch {
        /* hidden or not mounted yet */
      }
      // Re-fit if host is still resizing (e.g. webFrame layout cascading in).
      if (host.clientWidth !== w0 || host.clientHeight !== h0) {
        requestAnimationFrame(() => fitPane(pane, true))
      }
    }
    // Debounce — TUI CLIs thrash on rapid resize; initial settle needs a beat.
    if (immediate) {
      const t = resizeTimers.get(id)
      if (t) clearTimeout(t)
      resizeTimers.delete(id)
      apply()
      return
    }
    const existing = resizeTimers.get(id)
    if (existing) clearTimeout(existing)
    resizeTimers.set(
      id,
      setTimeout(() => {
        resizeTimers.delete(id)
        apply()
      }, 100),
    )
  }

  /**
   * Aggressive re-fit: keep polling host size until it stops increasing (or
   * we hit a frame cap). Catches webFrame zoom cascades where RO fires once
   * but the host keeps growing for several frames. Call after zoom, font swap,
   * or mode-switch — anywhere the layout might still be settling.
   * Generation counter cancels superseded loops (e.g. fast back-to-back zooms).
   */
  const refitGenerations = [0, 0]
  function refitUntilStable(pane: 0 | 1, maxFrames = 16): void {
    const gen = ++refitGenerations[pane]
    let frames = 0
    let lastW = -1
    let lastH = -1
    const tick = (): void => {
      if (gen !== refitGenerations[pane]) return // superseded
      const host = hostForPane(pane)
      if (!host || !hostReady(host)) return
      const w = host.clientWidth
      const h = host.clientHeight
      // Only call fit when size actually changed — avoids resize spam on settling.
      if (w !== lastW || h !== lastH) {
        lastW = w
        lastH = h
        fitPane(pane, true)
      }
      frames += 1
      if (frames < maxFrames) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  function fitVisible(immediate = false): void {
    fitPane(0, immediate)
    fitPane(1, immediate)
  }

  function ghostFor(id: string): GhostState {
    let g = ghosts.get(id)
    if (!g) {
      g = {
        mirror: createMirror(),
        suffix: '',
        match: null,
        matches: [],
        menuOpen: false,
        selected: 0,
        left: 0,
        top: 0,
      }
      ghosts.set(id, g)
    }
    return g
  }

  function clearGhost(id: string, keepMirror = true): void {
    const g = ghosts.get(id)
    if (!g) return
    if (g.timer) clearTimeout(g.timer)
    g.timer = undefined
    g.suffix = ''
    g.match = null
    g.matches = []
    g.menuOpen = false
    g.selected = 0
    if (!keepMirror) g.mirror = createMirror()
    if (activeId === id) syncGhostUi(id)
  }

  function cellMetrics(term: Terminal, host: HTMLDivElement): { cellW: number; cellH: number; padX: number; padY: number } {
    const screen = host.querySelector('.xterm-screen') as HTMLElement | null
    const cols = Math.max(term.cols, 1)
    const rows = Math.max(term.rows, 1)
    const w = screen?.clientWidth || host.clientWidth
    const h = screen?.clientHeight || host.clientHeight
    const padX = host.offsetLeft
    const padY = host.offsetTop
    return { cellW: w / cols, cellH: h / rows, padX, padY }
  }

  function positionGhost(id: string): void {
    const g = ghosts.get(id)
    const term = terminals.get(id)
    if (!g || !term) return
    const pane: 0 | 1 = paneIds[0] === id ? 0 : paneIds[1] === id ? 1 : focusedPane
    const host = hostForPane(pane)
    if (!host) return
    const { cellW, cellH, padX, padY } = cellMetrics(term, host)
    const buf = term.buffer.active
    const viewportY = buf.viewportY ?? 0
    g.left = padX + buf.cursorX * cellW
    g.top = padY + (buf.cursorY - viewportY) * cellH
  }

  function syncGhostUi(id: string | null): void {
    if (!id || id !== activeId) {
      // Still allow show if id is on focused pane
      if (!id || (paneIds[focusedPane] !== id && activeId !== id)) {
        ghostVisible = false
        ghostMenuOpen = false
        return
      }
    }
    const g = ghosts.get(id)
    if (!g || (!g.suffix && !g.menuOpen)) {
      ghostVisible = false
      ghostMenuOpen = false
      ghostText = ''
      return
    }
    positionGhost(id)
    ghostPane = paneIds[0] === id ? 0 : 1
    ghostLeft = g.left
    ghostTop = g.top
    ghostText = g.suffix
    ghostMatches = g.matches
    ghostSelected = g.selected
    ghostMenuOpen = g.menuOpen
    ghostVisible = Boolean(g.suffix) || g.menuOpen
  }

  async function refreshGhost(id: string): Promise<void> {
    const g = ghosts.get(id)
    const term = terminals.get(id)
    if (!g || !term) return
    const tab = tabs.find((t) => t.id === id)
    if (tab?.exited) {
      clearGhost(id)
      return
    }
    const alt = isAltScreen(term as unknown as { buffer: { active: { type?: string }; normal?: unknown } })
    const token = commandToken(g.mirror)
    if (!token || alt) {
      g.suffix = ''
      g.match = null
      g.matches = []
      if (!g.menuOpen) syncGhostUi(id)
      else syncGhostUi(id)
      return
    }
    try {
      const matches = (await api.pathComplete?.(token)) ?? []
      g.matches = matches
      const best = pickBestMatch(matches, token)
      if (shouldShowGhost({ altScreen: alt, token, match: best })) {
        g.match = best
        g.suffix = ghostSuffix(token, best!)
      } else {
        g.match = null
        g.suffix = ''
      }
      if (g.selected >= g.matches.length) g.selected = 0
    } catch {
      g.suffix = ''
      g.match = null
      g.matches = []
    }
    syncGhostUi(id)
  }

  function scheduleGhost(id: string): void {
    const g = ghostFor(id)
    if (g.timer) clearTimeout(g.timer)
    g.timer = setTimeout(() => {
      g.timer = undefined
      void refreshGhost(id)
    }, 50)
  }

  function acceptGhost(id: string, which?: string): void {
    const g = ghosts.get(id)
    if (!g) return
    const token = commandToken(g.mirror)
    const match = which ?? (g.menuOpen && g.matches[g.selected] ? g.matches[g.selected] : g.match)
    if (!token || !match) return
    const suffix = ghostSuffix(token, match)
    if (!suffix) return
    applyMirrorData(g.mirror, suffix)
    void api.write(id, suffix)
    g.menuOpen = false
    g.suffix = ''
    g.match = null
    g.matches = []
    syncGhostUi(id)
    scheduleGhost(id)
  }

  function copyTerminalSelection(term: Terminal): boolean {
    if (!term.hasSelection()) return false
    const text = term.getSelection()
    if (!text) return false
    void navigator.clipboard.writeText(text).catch(() => {})
    return true
  }

  function wireGhost(id: string, terminal: Terminal): void {
    const g = ghostFor(id)
    // xterm selection copy (Ctrl/Cmd+C when text selected; else let shell get SIGINT via onData).
    terminal.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const mod = ev.ctrlKey || ev.metaKey
      if (mod && !ev.altKey && (ev.key === 'c' || ev.key === 'C')) {
        if (copyTerminalSelection(terminal)) {
          ev.preventDefault()
          return false
        }
        return true
      }
      // Shift+Ctrl+C always copy selection (Windows terminal convention)
      if (ev.ctrlKey && ev.shiftKey && (ev.key === 'c' || ev.key === 'C' || ev.code === 'KeyC')) {
        if (copyTerminalSelection(terminal)) {
          ev.preventDefault()
          return false
        }
      }
      // Ctrl/Cmd+V paste
      if (mod && !ev.altKey && !ev.shiftKey && (ev.key === 'v' || ev.key === 'V')) {
        ev.preventDefault()
        void navigator.clipboard.readText().then((text) => {
          if (text) void api.write(id, text)
        }).catch(() => {})
        return false
      }
      const hasGhost = Boolean(g.suffix) || g.menuOpen
      if (ev.key === ' ' && ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault()
        void (async () => {
          await refreshGhost(id)
          if (g.matches.length) {
            g.menuOpen = true
            g.selected = 0
            if (!g.suffix && g.matches[0]) {
              const token = commandToken(g.mirror)
              if (token) {
                g.match = g.matches[0]!
                g.suffix = ghostSuffix(token, g.matches[0]!)
              }
            }
            syncGhostUi(id)
          }
        })()
        return false
      }
      if (!hasGhost) return true
      if (ev.key === 'Escape') {
        g.menuOpen = false
        g.suffix = ''
        g.match = null
        syncGhostUi(id)
        return false
      }
      if (g.menuOpen && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault()
        const n = g.matches.length
        if (!n) return false
        g.selected = ev.key === 'ArrowDown' ? (g.selected + 1) % n : (g.selected - 1 + n) % n
        const token = commandToken(g.mirror)
        const m = g.matches[g.selected]
        if (token && m) {
          g.match = m
          g.suffix = ghostSuffix(token, m)
        }
        syncGhostUi(id)
        return false
      }
      if (ev.key === 'Tab' && !ev.altKey && !ev.metaKey) {
        ev.preventDefault()
        acceptGhost(id)
        return false
      }
      if (ev.key === 'ArrowRight' && !ev.altKey && !ev.metaKey && !ev.ctrlKey && g.suffix && !g.menuOpen) {
        // Only accept when mirror is "at end" — always true for our end-only mirror
        ev.preventDefault()
        acceptGhost(id)
        return false
      }
      if (ev.key === 'Enter' && g.menuOpen) {
        ev.preventDefault()
        acceptGhost(id)
        return false
      }
      if (ev.key === 'ArrowDown' && g.suffix && !g.menuOpen && g.matches.length > 1) {
        ev.preventDefault()
        g.menuOpen = true
        g.selected = 0
        syncGhostUi(id)
        return false
      }
      return true
    })
    terminal.onData((data) => {
      applyMirrorData(g.mirror, data)
      void api.write(id, data)
      // Reset menu on normal typing
      if (g.menuOpen && data.length === 1 && data !== '\t') g.menuOpen = false
      scheduleGhost(id)
    })
    // Right-click copy when selection exists
    terminal.element?.addEventListener('contextmenu', (ev) => {
      if (!terminal.hasSelection()) return
      ev.preventDefault()
      copyTerminalSelection(terminal)
    })
  }

  async function mountPane(pane: 0 | 1): Promise<void> {
    const id = paneIds[pane]
    const host = hostForPane(pane)
    if (!host) return
    if (!id) {
      host.replaceChildren()
      host.style.opacity = '1'
      return
    }
    const terminal = terminals.get(id)
    if (!terminal) return
    // Hide until first good fit — no wrapped-prompt flash
    if (!readyHosts.has(host)) host.style.opacity = '0'
    if (!terminal.element) terminal.open(host)
    else if (host.firstElementChild !== terminal.element) host.replaceChildren(terminal.element)
    await waitHostSize(pane)
    // fonts.ready: wrong cell metrics → wrong cols → wrap blink
    try {
      await document.fonts?.ready
    } catch {
      /* ignore */
    }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    fitPane(pane, true)
    // One more settle pass if layout still catching up
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    fitPane(pane, true)
    // Always reveal — blank forever worse than rare wrap
    host.style.opacity = '1'
    // Keep refitting until host size stops growing (catches webFrame/grid
    // layouts that settle after our 2-RAF wait — leaves terminal cropped
    // otherwise). Runs in the background, doesn't block mount.
    refitUntilStable(pane)
  }

  async function activateTerminal(id: string, requestedPane: 0 | 1 = focusedPane): Promise<void> {
    const visiblePane = paneIds.indexOf(id)
    const pane = visiblePane >= 0 ? visiblePane as 0 | 1 : requestedPane
    if (visiblePane < 0) {
      paneIds[pane] = id
      paneIds = [...paneIds]
    }
    activeId = id
    focusedPane = pane
    syncWorkspace()
    await tick()
    const terminal = terminals.get(id)
    if (!terminal) return
    await mountPane(pane)
    terminal.focus()
    void refreshGhost(id)
  }

  async function connectSshByName(name: string): Promise<void> {
    try {
      const data = await listSsh()
      const host = (data.hosts ?? []).find((h) => h.name === name)
      if (!host) {
        error = `SSH host not found: ${name}`
        return
      }
      await launchSshHost(host)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function onSshConnectEvent(e: Event): void {
    const name = (e as CustomEvent<{ name?: string }>).detail?.name
    if (name) void connectSshByName(name)
  }

  function measureHost(_pane: 0 | 1): { cols: number; rows: number } {
    // Bootstrap conservatively; the first valid FitAddon measurement becomes
    // authoritative before the host is revealed.
    return { cols: 40, rows: 10 }
  }

  /** Wait until pane host has real layout (avoids tiny seed → jump-fit). */
  async function waitHostSize(pane: 0 | 1, tries = 24): Promise<boolean> {
    let lastW = 0
    let lastH = 0
    let stable = 0
    for (let i = 0; i < tries; i++) {
      const host = hostForPane(pane)
      if (hostReady(host)) {
        // Need 2 consecutive equal measurements — layout mid-transition is the blink.
        if (host.clientWidth === lastW && host.clientHeight === lastH) {
          stable += 1
          if (stable >= 2) return true
        } else {
          stable = 0
          lastW = host.clientWidth
          lastH = host.clientHeight
        }
      } else {
        stable = 0
        lastW = 0
        lastH = 0
      }
      await tick()
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
    return hostReady(hostForPane(pane))
  }

  async function addTerminal(
    cwd = app.activeProject?.path,
    projectId = currentProjectId,
    pane: 0 | 1 = focusedPane,
    opts?: { command?: string; args?: string[]; title?: string },
  ): Promise<void> {
    if (!cwd) return
    if (!projectId) return
    // Don't spawn while Terminal stage is hidden — host is 0×0 → seed/fit thrash.
    if (app.mode !== 'terminal' && !opts?.command) return
    // Dedupe in-flight creates (shell / same vendor title)
    const createKey = `${projectId}:${opts?.command ?? 'shell'}:${opts?.title ?? ''}`
    if (creatingFor.has(createKey)) return
    creatingFor.add(createKey)
    const workspace = workspaceFor(projectId)
    const targetPane: 0 | 1 = pane === 1 || paneIds[1] ? pane : 0
    error = ''
    try {
      await waitHostSize(targetPane)
      try {
        await document.fonts?.ready
      } catch {
        /* ignore */
      }
      const seed = measureHost(targetPane)
      const created = await api.create(
        cwd,
        seed.cols,
        seed.rows,
        opts?.command ? { command: opts.command, args: opts.args ?? [] } : undefined,
      )
      if (destroyed) {
        await api.kill(created.id)
        return
      }
      const terminal = new Terminal({
        cols: seed.cols,
        rows: seed.rows,
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: fontStack(app.ui.fontFamily),
        fontSize: EDITOR_FONT_SIZE,
        lineHeight: 1.25,
        scrollback: 5_000,
        // Disable bold → bright swap thrash some TUIs re-render on.
        drawBoldTextInBrightColors: false,
        theme: { ...xtermTheme },
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      wireGhost(created.id, terminal)
      terminals.set(created.id, terminal)
      fitAddons.set(created.id, fit)
      terminalSizes.set(created.id, { cols: seed.cols, rows: seed.rows })
      const buffered = pendingData.get(created.id)
      if (buffered) {
        terminal.write(buffered)
        pendingData.delete(created.id)
      }
      const title =
        opts?.title ??
        (opts?.command ? opts.command : `Terminal ${workspace.nextTitle++}`)
      workspace.tabs = [...workspace.tabs, { id: created.id, title, exited: false }]
      workspace.paneTabs[targetPane] = [...workspace.paneTabs[targetPane], created.id]
      if (currentProjectId === projectId) {
        tabs = workspace.tabs
        paneTabs = [ [...workspace.paneTabs[0]], [...workspace.paneTabs[1]] ]
        activeId = created.id
        workspace.activeId = created.id
        await activateTerminal(created.id, targetPane)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      creatingFor.delete(createKey)
    }
  }

  async function launchSshHost(host: SshHostInfo): Promise<void> {
    error = ''
    try {
      const plan = (await window.enpiistudio.enpii.request('ssh.plan', { host: host.name })) as {
        command: string
        args: string[]
      }
      await addTerminal(app.activeProject?.path, currentProjectId, focusedPane, {
        command: plan.command,
        args: plan.args,
        title: `ssh:${host.name}`,
      })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function closeTerminal(id: string): Promise<void> {
    const index = tabs.findIndex((tab) => tab.id === id)
    const wasVisible = paneIds.includes(id)
    const timer = resizeTimers.get(id)
    if (timer) clearTimeout(timer)
    resizeTimers.delete(id)
    await api.kill(id)
    terminals.get(id)?.dispose()
    terminals.delete(id)
    fitAddons.delete(id)
    terminalSizes.delete(id)
    pendingData.delete(id)
    nudgedForFontKey.delete(id)
    clearGhost(id, false)
    ghosts.delete(id)
    tabs = tabs.filter((tab) => tab.id !== id)
    paneTabs = [paneTabs[0].filter((tabId) => tabId !== id), paneTabs[1].filter((tabId) => tabId !== id)]
    paneIds = paneIds.map((paneId) => paneId === id ? null : paneId) as PaneIds
    if (wasVisible && paneIds[1]) paneIds = [paneIds[1], null]
    normalizePaneState((tabs[index] ?? tabs[index - 1] ?? tabs[0])?.id)
    syncWorkspace()
    await tick()
    await mountPane(0)
    await mountPane(1)
  }

  async function splitTerminal(): Promise<void> {
    if (paneIds[1]) {
      await activateTerminal(paneIds[1], 1)
      return
    }
    if (!paneIds[0]) await addTerminal(app.activeProject?.path, currentProjectId, 0)
    if (!paneIds[1]) await addTerminal(app.activeProject?.path, currentProjectId, 1)
  }

  async function focusPane(pane: 0 | 1): Promise<void> {
    const id = paneIds[pane]
    if (id) await activateTerminal(id, pane)
  }

  function startRename(tab: TerminalTab): void {
    editingId = tab.id
    editingTitle = tab.title
    void tick().then(() => {
      renameInput?.focus()
      renameInput?.select()
    })
  }

  function finishRename(save: boolean): void {
    const tab = tabs.find((item) => item.id === editingId)
    const title = editingTitle.trim()
    if (save && tab && title) tab.title = title
    editingId = null
    syncWorkspace()
  }

  async function switchProject(projectId: string, cwd: string): Promise<void> {
    syncWorkspace()
    currentProjectId = projectId
    const workspace = workspaceFor(projectId)
    tabs = workspace.tabs
    activeId = workspace.activeId
    paneIds = [...workspace.paneIds]
    paneTabs = [ [...workspace.paneTabs[0]], [...workspace.paneTabs[1]] ]
    focusedPane = workspace.focusedPane
    normalizePaneState()
    readyHosts.clear()
    if (primaryHost) primaryHost.style.opacity = '0'
    if (secondaryHost) secondaryHost.style.opacity = '0'
    primaryHost?.replaceChildren()
    secondaryHost?.replaceChildren()
    await tick()
    if (destroyed || currentProjectId !== projectId) return
    // Only mount/create when Terminal mode is visible — else host is display:none.
    if (app.mode !== 'terminal') return
    if (paneIds[0] && terminals.has(paneIds[0])) {
      await mountPane(0)
      await mountPane(1)
      if (activeId) await activateTerminal(activeId, focusedPane)
    } else if (tabs.length === 0) {
      await addTerminal(cwd, projectId)
    }
  }

  async function onTerminalVisible(): Promise<void> {
    if (destroyed || app.mode !== 'terminal') return
    const projectId = currentProjectId ?? app.activeProjectId
    const cwd = app.activeProject?.path
    if (!projectId || !cwd) return
    await tick()
    await waitHostSize(0)
    if (destroyed || app.mode !== 'terminal') return
    if (paneIds[0] && terminals.has(paneIds[0])) {
      await mountPane(0)
      await mountPane(1)
      if (activeId) terminals.get(activeId)?.focus()
    } else if (tabs.length === 0) {
      await addTerminal(cwd, projectId)
    } else if (paneIds[0] && !terminals.has(paneIds[0])) {
      // Workspace restored but PTY gone (reload) — fresh shell
      await addTerminal(cwd, projectId)
    } else {
      fitVisible(true)
    }
  }

  $effect(() => {
    const projectId = app.activeProjectId
    const cwd = app.activeProject?.path
    if (!projectId || !cwd) return
    untrack(() => void switchProject(projectId, cwd))
  })

  // Entering Terminal mode: host unhides → wait stable size → mount/fit once.
  $effect(() => {
    const mode = app.mode
    if (mode !== 'terminal') {
      // Leave: drop ready flag so next enter re-hides until fit
      readyHosts.clear()
      return
    }
    untrack(() => void onTerminalVisible())
  })

  // Live mono family + re-fit after UI zoom (CSS zoom changes host px box).
  $effect(() => {
    const family = fontStack(app.ui.fontFamily)
    void app.ui.uiZoom
    for (const terminal of terminals.values()) {
      terminal.options.fontFamily = family
      terminal.options.fontSize = EDITOR_FONT_SIZE
      // Force renderer to re-measure cell metrics — without this, FitAddon
      // reads stale css.cell.width/height from before the font swap and
      // computes wrong cols (terminal stays "cropped" until the next paint).
      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1))
      } catch {
        /* not yet mounted */
      }
    }
    // Defer one frame: webFrame.setZoomFactor reflows asynchronously, so an
    // immediate fit would measure the pre-zoom box and crop the terminal.
    untrack(() => {
      requestAnimationFrame(() => {
        refitUntilStable(0)
        refitUntilStable(1)
      })
    })
  })

  onMount(() => {
    // Warm PATH cache once (non-blocking).
    void api.pathComplete?.('').catch(() => {})
    const offData = api.onData(({ id, data }) => {
      const terminal = terminals.get(id)
      const g = ghosts.get(id)
      if (g) notePtyOutput(g.mirror, data)
      if (terminal) {
        terminal.write(data)
        // Reposition ghost after paint
        requestAnimationFrame(() => {
          if (g?.suffix || g?.menuOpen) {
            positionGhost(id)
            if (activeId === id || paneIds[focusedPane] === id) syncGhostUi(id)
          }
        })
      } else pendingData.set(id, `${pendingData.get(id) ?? ''}${data}`)
    })
    const offExit = api.onExit(({ id, exitCode }) => {
      for (const workspace of workspaces.values()) {
        const tab = workspace.tabs.find((item) => item.id === id)
        if (tab) tab.exited = true
      }
      clearGhost(id, false)
      ghosts.delete(id)
      terminals.get(id)?.write(`\r\n\x1b[90m[process exited ${exitCode}]\x1b[0m\r\n`)
    })
    window.addEventListener('enpiistudio:terminal-ssh', onSshConnectEvent)
    // Re-fit once webFrame finishes its reflow (terminal cells stay cropped
    // until the host box is at its post-zoom dimensions).
    const onZoomApplied = () => {
      if (app.mode !== 'terminal') return
      refitUntilStable(0)
      refitUntilStable(1)
    }
    window.addEventListener('enpiistudio:zoom-applied', onZoomApplied)
    resizeObserver = new ResizeObserver(() => {
      // ResizeObserver fires during layout pass — the host may still grow.
      // Use the stable loop instead of the 100ms debounce so we catch the
      // final settled size even on a slow webFrame cascade.
      refitUntilStable(0)
      refitUntilStable(1)
    })
    return () => {
      offData()
      offExit()
      window.removeEventListener('enpiistudio:terminal-ssh', onSshConnectEvent)
      window.removeEventListener('enpiistudio:zoom-applied', onZoomApplied)
      resizeObserver?.disconnect()
    }
  })

  // Re-bind observer when hosts mount (bind:this is late vs onMount)
  $effect(() => {
    const a = primaryHost
    const b = secondaryHost
    const obs = resizeObserver
    if (!obs) return
    if (a) obs.observe(a)
    if (b) obs.observe(b)
    return () => {
      if (a) obs.unobserve(a)
      if (b) obs.unobserve(b)
    }
  })

  onDestroy(() => {
    destroyed = true
    for (const t of resizeTimers.values()) clearTimeout(t)
    resizeTimers.clear()
    for (const g of ghosts.values()) if (g.timer) clearTimeout(g.timer)
    ghosts.clear()
    for (const id of terminals.keys()) void api.kill(id)
    for (const terminal of terminals.values()) terminal.dispose()
    terminals.clear()
    nudgedForFontKey.clear()
    workspaces.clear()
  })
</script>


<div class="relative flex h-full min-h-0 flex-col p-0">
  <div class="absolute right-0 top-0 z-[6] flex items-center justify-end gap-2 px-2 pt-1.5">
    <button
      type="button"
      class="grid size-7 place-items-center rounded text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
      aria-label="Split terminal"
      title="Split terminal"
      onclick={() => void splitTerminal()}><Icon name="diff" size={14} /></button
    >
  </div>
  <section
    class="relative min-h-0 flex-1 overflow-hidden {paneIds[1]
      ? 'grid grid-cols-2'
      : 'grid grid-cols-1'}"
  >
    {#if error}
      <div class="absolute inset-x-0 top-10 z-10 p-3.5 font-mono text-[11px] text-studio-error">{error}</div>
    {/if}
    <div
      class="grid min-h-0 min-w-0 grid-rows-[36px_minmax(0,1fr)] overflow-hidden {focusedPane === 0
        ? 'ring-1 ring-inset ring-studio-purple/40'
        : ''}"
      onfocusin={() => void focusPane(0)}
    >
      <div
        class="flex h-9 min-w-0 items-center overflow-x-auto border-b border-border-subtle bg-studio-panel/95"
        role="tablist"
        aria-label="Primary terminal pane"
      >
        {#each paneTabs[0] as id (id)}
          {@const tab = tabs.find((item) => item.id === id)}
          {#if tab}
            <div
              class="flex h-full items-center border-r border-white/5 {tab.id === activeId
                ? 'border-b-2 border-b-studio-purple bg-studio-purple/20'
                : 'border-b-2 border-b-transparent'}"
            >
              {#if editingId === tab.id}
                <input
                  class="mx-1 rounded border border-studio-purple/75 bg-black/38 px-1.5 py-0.5 font-mono text-[10px] text-studio-text outline-none"
                  bind:this={renameInput}
                  bind:value={editingTitle}
                  aria-label="Terminal name"
                  onblur={() => finishRename(true)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') finishRename(true)
                    if (event.key === 'Escape') finishRename(false)
                  }}
                />
              {:else}
                <button
                  type="button"
                  class="flex items-center gap-1.5 px-1.5 pl-2.5 font-mono text-[10px] {tab.id === activeId
                    ? 'text-studio-text'
                    : 'text-studio-text-dim hover:text-studio-text'}"
                  role="tab"
                  aria-selected={tab.id === activeId}
                  onclick={() => void activateTerminal(tab.id, 0)}
                  ondblclick={() => startRename(tab)}
                >
                  <span
                    class="size-1.5 rounded-lg {tab.exited ? 'bg-studio-text-dim' : 'bg-studio-success'}"
                  ></span>
                  {tab.title}
                </button>
              {/if}
              <button
                type="button"
                class="mx-1 grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
                aria-label={`Close ${tab.title}`}
                onclick={() => void closeTerminal(tab.id)}><Icon name="close" size={12} /></button
              >
            </div>
          {/if}
        {/each}
        <button
          type="button"
          class="ml-1.5 grid size-7 shrink-0 place-items-center rounded text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
          aria-label="New terminal"
          title="New terminal"
          onclick={() => void addTerminal(app.activeProject?.path, currentProjectId, 0)}
          ><Icon name="plus" size={14} /></button
        >
      </div>
      <div class="relative min-h-0">
        {#if paneTabs[0].length === 0 && !error}
          <button
            type="button"
            class="absolute left-1/2 top-1/2 z-10 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/12 bg-studio-card text-studio-text shadow-md hover:border-studio-gold/40 hover:text-studio-gold"
            aria-label="New terminal"
            title="New terminal"
            onclick={() => void addTerminal(app.activeProject?.path, currentProjectId, 0)}
          >
            <Icon name="plus" size={18} />
          </button>
        {/if}
        <div class="relative h-full min-h-0 w-full bg-[#0b0c10] p-3">
          <div
            class="h-full min-h-0 min-w-0 w-full transition-opacity duration-75"
            style="opacity:0"
            bind:this={primaryHost}
          ></div>
          {#if ghostVisible && ghostPane === 0}
            <div
              class="pointer-events-none absolute z-[4] font-mono whitespace-pre text-studio-text-dim/50"
              style="left:{ghostLeft}px;top:{ghostTop}px;font-size:{EDITOR_FONT_SIZE}px;line-height:1.25;font-family:{fontStack(app.ui.fontFamily)}"
            >{ghostText}</div>
            {#if ghostMenuOpen && ghostMatches.length}
              <div
                class="absolute z-[5] max-h-48 min-w-[10rem] overflow-auto rounded-md border border-border-subtle bg-studio-card py-1 shadow-lg"
                style="left:{ghostLeft}px;top:{ghostTop + EDITOR_FONT_SIZE * 1.25 + 4}px"
                role="listbox"
              >
                {#each ghostMatches as m, i (m)}
                  <button
                    type="button"
                    class="block w-full px-2.5 py-1 text-left font-mono text-[11px] {i === ghostSelected
                      ? 'bg-studio-purple/25 text-studio-text'
                      : 'text-studio-text-dim hover:bg-white/6 hover:text-studio-text'}"
                    role="option"
                    aria-selected={i === ghostSelected}
                    onclick={() => activeId && acceptGhost(activeId, m)}
                  >{m}</button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>
    <div
      class="min-h-0 min-w-0 overflow-hidden border-l border-white/8 {paneIds[1]
        ? 'grid grid-rows-[36px_minmax(0,1fr)]'
        : 'hidden'} {focusedPane === 1 ? 'ring-1 ring-inset ring-studio-purple/40' : ''}"
      onfocusin={() => void focusPane(1)}
    >
      <div
        class="flex h-9 min-w-0 items-center overflow-x-auto border-b border-border-subtle bg-studio-panel/95"
        role="tablist"
        aria-label="Secondary terminal pane"
      >
        {#each paneTabs[1] as id (id)}
          {@const tab = tabs.find((item) => item.id === id)}
          {#if tab}
            <div
              class="flex h-full items-center border-r border-white/5 {tab.id === activeId
                ? 'border-b-2 border-b-studio-purple bg-studio-purple/20'
                : 'border-b-2 border-b-transparent'}"
            >
              {#if editingId === tab.id}
                <input
                  class="mx-1 rounded border border-studio-purple/75 bg-black/38 px-1.5 py-0.5 font-mono text-[10px] text-studio-text outline-none"
                  bind:this={renameInput}
                  bind:value={editingTitle}
                  aria-label="Terminal name"
                  onblur={() => finishRename(true)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') finishRename(true)
                    if (event.key === 'Escape') finishRename(false)
                  }}
                />
              {:else}
                <button
                  type="button"
                  class="flex items-center gap-1.5 px-1.5 pl-2.5 font-mono text-[10px] {tab.id === activeId
                    ? 'text-studio-text'
                    : 'text-studio-text-dim hover:text-studio-text'}"
                  role="tab"
                  aria-selected={tab.id === activeId}
                  onclick={() => void activateTerminal(tab.id, 1)}
                  ondblclick={() => startRename(tab)}
                >
                  <span
                    class="size-1.5 rounded-lg {tab.exited ? 'bg-studio-text-dim' : 'bg-studio-success'}"
                  ></span>
                  {tab.title}
                </button>
              {/if}
              <button
                type="button"
                class="mx-1 grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
                aria-label={`Close ${tab.title}`}
                onclick={() => void closeTerminal(tab.id)}><Icon name="close" size={12} /></button
              >
            </div>
          {/if}
        {/each}
        <button
          type="button"
          class="ml-1.5 grid size-7 shrink-0 place-items-center rounded text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
          aria-label="New terminal in split pane"
          title="New terminal in split pane"
          onclick={() => void addTerminal(app.activeProject?.path, currentProjectId, 1)}
          ><Icon name="plus" size={14} /></button
        >
      </div>
      <div class="relative min-h-0">
        {#if paneIds[1] && paneTabs[1].length === 0 && !error}
          <button
            type="button"
            class="absolute left-1/2 top-1/2 z-10 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/12 bg-studio-card text-studio-text shadow-md hover:border-studio-gold/40 hover:text-studio-gold"
            aria-label="New terminal in split pane"
            title="New terminal in split pane"
            onclick={() => void addTerminal(app.activeProject?.path, currentProjectId, 1)}
          >
            <Icon name="plus" size={18} />
          </button>
        {/if}
        <div class="relative h-full min-h-0 w-full bg-[#0b0c10] p-3">
          <div
            class="h-full min-h-0 min-w-0 w-full transition-opacity duration-75"
            style="opacity:0"
            bind:this={secondaryHost}
          ></div>
          {#if ghostVisible && ghostPane === 1}
            <div
              class="pointer-events-none absolute z-[4] font-mono whitespace-pre text-studio-text-dim/50"
              style="left:{ghostLeft}px;top:{ghostTop}px;font-size:{EDITOR_FONT_SIZE}px;line-height:1.25;font-family:{fontStack(app.ui.fontFamily)}"
            >{ghostText}</div>
            {#if ghostMenuOpen && ghostMatches.length}
              <div
                class="absolute z-[5] max-h-48 min-w-[10rem] overflow-auto rounded-md border border-border-subtle bg-studio-card py-1 shadow-lg"
                style="left:{ghostLeft}px;top:{ghostTop + EDITOR_FONT_SIZE * 1.25 + 4}px"
                role="listbox"
              >
                {#each ghostMatches as m, i (m)}
                  <button
                    type="button"
                    class="block w-full px-2.5 py-1 text-left font-mono text-[11px] {i === ghostSelected
                      ? 'bg-studio-purple/25 text-studio-text'
                      : 'text-studio-text-dim hover:bg-white/6 hover:text-studio-text'}"
                    role="option"
                    aria-selected={i === ghostSelected}
                    onclick={() => activeId && acceptGhost(activeId, m)}
                  >{m}</button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </section>
</div>

<!-- xterm injects .xterm; host needs height chain -->
<style>
  :global(.xterm) {
    height: 100%;
    width: 100%;
  }
  :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
