<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import type { TerminalHostEvent } from '../../../electron/terminal/types'
  import '@xterm/xterm/css/xterm.css'
  import { listSsh, type SshHostInfo } from '../enpii'
  import { state as app, fontStack, EDITOR_FONT_SIZE } from '../store.svelte'
  import { Icon } from '../icons'
  import { Button, Badge, Dropdown } from './ui'
  import type { DropdownItem } from './ui'

  import type { CommandBlock, TerminalTab, TerminalApi } from '../terminal/types'
  import { STALE_RUN_MS, FRONTEND_IDLE_MS } from '../terminal/constants'
  import {
    uid,
    markerString,
    markerNumber,
    looksLikeShellPrompt,
    formatDuration,
    formatIdleSince,
    stateLabel,
    stateClasses,
    blockStatusClass,
    blockLeftAccent,
    outputPreview,
    detectStreamFollow,
    pathTitle,
  } from '../terminal/helpers'
  import { loadHistory, pushHistory, canBrowseHistory } from '../terminal/commandHistory'
  import { TabStore } from '../terminal/tabStore.svelte'
  import { PtyBridge } from '../terminal/ptyBridge'
  import { SurfaceManager } from '../terminal/surfaceManager'

    let sshHosts = $state<SshHostInfo[]>([])
  async function loadSshHosts(): Promise<void> {
    try {
      const data = await listSsh()
      sshHosts = data.hosts ?? []
    } catch {
      sshHosts = []
    }
  }

  const sshDropdownItems = $derived<DropdownItem[]>(
    sshHosts.length > 0
      ? sshHosts.map((h) => ({
          id: h.host,
          label: `ssh ${h.host}`,
          description: `${h.user ? h.user + '@' : ''}${h.hostname || h.host}${h.port && h.port !== 22 ? ':' + h.port : ''}`,
        }))
      : [{ id: 'none', label: 'No SSH hosts configured', disabled: true }]
  )

  const api: TerminalApi | undefined = typeof window !== 'undefined' ? (window as any).enpiistudio?.terminal : undefined

  const store = new TabStore()
  const bridge = new PtyBridge(api)
  const surfaces = new SurfaceManager(api)

  let composerEl = $state<HTMLTextAreaElement>()
  let stageEl = $state<HTMLDivElement>()
  let stickBottom = $state(true)
  let nowTick = $state(Date.now())
  let activeSurfaceHost = $state<HTMLDivElement>()
  let mountedSessionId = $state<string | null>(null)

  let currentProjectId: string | null = null
  let destroyed = false
  let resizeObserver: ResizeObserver | undefined

  const staleRunTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const idleFinalizeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function activeTab(): TerminalTab | null {
    return store.activeTab()
  }

  function tabByPty(ptyId: string): TerminalTab | null {
    const key = bridge.tabByPtyId.get(ptyId)
    if (!key) return null
    return store.findTab(key)
  }

  let tabs = $derived(store.tabs)
  let activeId = $derived(store.activeId)
  let error = $derived(store.error)
  function finalizeRunningBlock(tabId: string, blockId: string, exitCode: number): void {
    const tab = store.findTab(tabId)
    if (!tab) return
    const block = tab.blocks.find((b) => b.id === blockId)
    if (!block || block.state !== 'running') return
    store.applyBlockUpdate(tabId, blockId, {
      state: exitCode === 0 ? 'success' : 'failed',
      exitCode,
      finishedAt: Date.now(),
      durationMs: Date.now() - block.startedAt,
      isLiveSurface: false,
      output: block.output || (bridge.liveOutputByPtyId.get(tabId) ?? ''),
    })
    store.applyTabPatch(tabId, { runningCommandId: null })
    cancelStaleTimer(tabId)
    cancelIdleFinalize(tabId)
    bridge.liveOutputByPtyId.delete(tabId)
    bridge.blockByPtyId.delete(tabId)
    if (mountedSessionId === tabId) unmountActiveSurface()
    void scrollToBottom(true)
  }

  function startStaleTimer(tabId: string, blockId: string): void {
    cancelStaleTimer(tabId)
    const tab = store.findTab(tabId)
    if (!tab) return
    const block = tab.blocks.find((b) => b.id === blockId)
    if (!block || block.isStreamFollow) return
    const handle = setTimeout(() => {
      const tab = store.findTab(tabId)
      if (!tab) return
      const block = tab.blocks.find((b) => b.id === blockId)
      if (!block || block.state !== 'running' || block.isStreamFollow) return
      store.applyBlockUpdate(tab.id, blockId, {
        state: 'failed',
        exitCode: undefined,
        finishedAt: Date.now(),
        durationMs: Date.now() - block.startedAt,
        isLiveSurface: false,
        output: (block.output ?? '') + '\r\n\x1b[90m[command reached timeout without a final marker \u2013 may still be running]\x1b[0m\r\n',
      })
      store.applyTabPatch(tab.id, { runningCommandId: null })
      cancelIdleFinalize(tab.id)
      bridge.blockByPtyId.delete(tabId)
      if (mountedSessionId === tabId) unmountActiveSurface()
      void scrollToBottom(true)
    }, STALE_RUN_MS)
    staleRunTimers.set(tabId, handle)
  }

  function cancelStaleTimer(tabId: string): void {
    const handle = staleRunTimers.get(tabId)
    if (handle) {
      clearTimeout(handle)
      staleRunTimers.delete(tabId)
    }
  }

  function cancelIdleFinalize(tabId: string): void {
    const handle = idleFinalizeTimers.get(tabId)
    if (handle) {
      clearTimeout(handle)
      idleFinalizeTimers.delete(tabId)
    }
  }

  function armIdleFinalize(tabId: string, blockId: string): void {
    cancelIdleFinalize(tabId)
    const handle = setTimeout(() => {
      idleFinalizeTimers.delete(tabId)
      const tab = store.findTab(tabId)
      if (!tab) return
      const block = tab.blocks.find((b) => b.id === blockId)
      if (!block || block.state !== 'running') return
      if (block.isStreamFollow) return
      const last = bridge.lastPtyDataAt.get(tabId) ?? 0
      const sinceLast = Date.now() - last
      if (sinceLast < FRONTEND_IDLE_MS) {
        const remaining = Math.max(100, FRONTEND_IDLE_MS - sinceLast)
        idleFinalizeTimers.set(
          tabId,
          setTimeout(() => armIdleFinalize(tabId, blockId), remaining),
        )
        return
      }
      const buffered = bridge.liveOutputByPtyId.get(tabId) ?? ''
      store.applyBlockUpdate(tab.id, blockId, {
        state: 'success',
        exitCode: 0,
        finishedAt: Date.now(),
        durationMs: Date.now() - block.startedAt,
        isLiveSurface: false,
        output: (block.output ?? '') + buffered,
      })
      store.applyTabPatch(tab.id, { runningCommandId: null })
      cancelStaleTimer(tab.id)
      cancelIdleFinalize(tab.id)
      bridge.liveOutputByPtyId.delete(tab.id)
      bridge.blockByPtyId.delete(tab.id)
      if (mountedSessionId === tab.id) unmountActiveSurface()
      void scrollToBottom(true)
    }, FRONTEND_IDLE_MS)
    idleFinalizeTimers.set(tabId, handle)
  }
  function applyPtyData(id: string, data: string): void {
    const tab = tabByPty(id)
    if (!tab || !data) return
    bridge.lastPtyDataAt.set(tab.id, Date.now())
    const blockId = tab.runningCommandId
    if (blockId) {
      const block = tab.blocks.find((b) => b.id === blockId)
      if (block) {
        const nextOutput = (block.output ?? '') + data
        store.applyBlockUpdate(tab.id, blockId, { output: nextOutput })
        if (!block.isStreamFollow && looksLikeShellPrompt(nextOutput)) {
          finalizeRunningBlock(tab.id, block.id, 0)
          return
        }
      }
    }
    const terminal = surfaces.terminals.get(id)
    if (terminal) {
      terminal.write(data)
    } else {
      const previous = bridge.liveOutputByPtyId.get(id) ?? ''
      bridge.liveOutputByPtyId.set(id, previous + data)
    }
    requestAnimationFrame(() => scrollToBottom(false))
  }

  function applyPtyExit(id: string, exitCode: number): void {
    const tab = tabByPty(id)
    if (!tab) {
      bridge.liveOutputByPtyId.delete(id)
      cancelStaleTimer(id)
      return
    }
    const blockId = tab.runningCommandId
    if (blockId) {
      const block = tab.blocks.find((b) => b.id === blockId)
      if (block) {
        store.applyBlockUpdate(tab.id, blockId, {
          state: 'exited',
          exitCode,
          finishedAt: Date.now(),
          isLiveSurface: false,
          output: (block.output ?? '') + (bridge.liveOutputByPtyId.get(id) ?? ''),
        })
      }
      store.applyTabPatch(tab.id, { runningCommandId: null, exited: true })
    } else {
      store.applyTabPatch(tab.id, { exited: true })
    }
    cancelStaleTimer(tab.id)
    cancelIdleFinalize(tab.id)
    bridge.liveOutputByPtyId.delete(id)
    if (mountedSessionId === id) unmountActiveSurface()
    if (surfaces.terminals.get(id)) {
      surfaces.terminals.get(id)?.write(`\r\n\x1b[90m[process exited ${exitCode}]\x1b[0m\r\n`)
    }
  }

  function applyShellMarker(id: string, event: Extract<TerminalHostEvent, { type: 'shell_marker' }>): void {
    const { marker } = event
    const cwd = markerString(marker.payload, 'cwd')
    const tab = tabByPty(id)
    if (!tab) return
    if (marker.event === 'prompt_ready') {
      if (cwd) store.applyTabPatch(tab.id, { cwd })
      return
    }
    if (marker.event === 'command_start') {
      const command = markerString(marker.payload, 'command') ?? ''
      const existing = tab.runningCommandId
        ? tab.blocks.find((b) => b.id === tab.runningCommandId)
        : undefined
      if (existing && existing.state === 'running') {
        store.applyBlockUpdate(tab.id, existing.id, {
          command: command || existing.command,
          cwd: cwd ?? existing.cwd,
          isLiveSurface: true,
          isStreamFollow: existing.isStreamFollow ?? detectStreamFollow(command || existing.command),
        })
        bridge.blockByPtyId.set(id, existing.id)
        bridge.liveOutputByPtyId.delete(id)
        if (cwd) store.applyTabPatch(tab.id, { cwd })
        void tick().then(() => {
          if (store.activeId === tab.id) void mountActiveSurface(id)
          void scrollToBottom(true)
        })
        return
      }
      const block: CommandBlock = {
        id: uid(),
        sessionId: id,
        command,
        cwd: cwd ?? tab.cwd,
        shell: tab.shell,
        state: 'running',
        startedAt: Date.now(),
        output: '',
        isLiveSurface: true,
        isStreamFollow: detectStreamFollow(command),
      }
      store.applyTabPatch(tab.id, {
        cwd: cwd ?? tab.cwd,
        runningCommandId: block.id,
        blocks: [...tab.blocks, block],
      })
      bridge.blockByPtyId.set(id, block.id)
      bridge.liveOutputByPtyId.delete(id)
      const term = surfaces.terminals.get(id); if (term) { term.reset(); term.clear(); term.write('\x1b[2J\x1b[3J\x1b[H'); }
      void tick().then(() => {
        if (store.activeId === tab.id) void mountActiveSurface(id)
        void scrollToBottom(true)
      })
      return
    }
    if (marker.event === 'command_end') {
      const exitCode = markerNumber(marker.payload, 'exitCode') ?? 1
      const duration = markerNumber(marker.payload, 'durationMs')
      const blockId = tab.runningCommandId ?? bridge.blockByPtyId.get(id)
      if (blockId) {
        store.applyBlockUpdate(tab.id, blockId, {
          state: exitCode === 0 ? 'success' : 'failed',
          exitCode,
          durationMs: duration,
          finishedAt: Date.now(),
          isLiveSurface: false,
          output: (tab.blocks.find((b) => b.id === blockId)?.output ?? '') + (bridge.liveOutputByPtyId.get(id) ?? ''),
        })
      }
      store.applyTabPatch(tab.id, {
        cwd: cwd ?? tab.cwd,
        runningCommandId: null,
      })
      cancelStaleTimer(tab.id)
      cancelIdleFinalize(tab.id)
      bridge.blockByPtyId.delete(id)
      bridge.liveOutputByPtyId.delete(id)
      if (mountedSessionId === id) unmountActiveSurface()
      void scrollToBottom(true)
      return
    }
    if (marker.event === 'integration_error') {
      const message = markerString(marker.payload, 'message') ?? 'Shell integration unavailable'
      const blockId = tab.runningCommandId
      if (blockId) {
        store.applyBlockUpdate(tab.id, blockId, { state: 'integration_error', message })
      } else {
        const block: CommandBlock = {
          id: uid(),
          sessionId: id,
          command: '[integration_error]',
          cwd: cwd ?? tab.cwd,
          shell: tab.shell,
          state: 'integration_error',
          startedAt: Date.now(),
          output: '',
          isLiveSurface: true,
        }
        store.applyTabPatch(tab.id, { blocks: [...tab.blocks, block] })
      }
      void message
    }
  }

  function applyHostEvent(event: TerminalHostEvent): void {
    if (!bridge.noteSequence(event.id, event.sequence)) return
    if (event.type === 'data') applyPtyData(event.id, event.data)
    else if (event.type === 'exit') applyPtyExit(event.id, event.exitCode)
    else applyShellMarker(event.id, event)
  }
  function getFontFamily(): string {
    return fontStack(app.ui.fontFamily)
  }

  function fitActiveSurface(immediate = false): void {
    surfaces.fitSurface(
      mountedSessionId,
      activeSurfaceHost,
      getFontFamily(),
      EDITOR_FONT_SIZE,
      app.ui.uiZoom,
      immediate,
    )
  }

  function refitUntilStable(maxFrames = 16): void {
    surfaces.refitUntilStable(
      mountedSessionId,
      activeSurfaceHost,
      getFontFamily(),
      EDITOR_FONT_SIZE,
      app.ui.uiZoom,
      maxFrames,
    )
  }

  async function mountActiveSurface(ptyId: string): Promise<void> {
    if (!activeSurfaceHost) return
    const terminal = surfaces.terminals.get(ptyId)
    if (!terminal) return
    mountedSessionId = ptyId
    activeSurfaceHost.style.opacity = '1'
    if (!terminal.element) {
      terminal.open(activeSurfaceHost)
    } else if (activeSurfaceHost.firstElementChild !== terminal.element) {
      activeSurfaceHost.replaceChildren(terminal.element)
    }
    try {
      terminal.refresh(0, Math.max(0, terminal.rows - 1))
    } catch { /* ignore */ }
    await waitHostSize()
    fitActiveSurface(true)
    terminal.focus()
    refitUntilStable()
  }

  function unmountActiveSurface(): void {
    const host = activeSurfaceHost
    const ptyId = mountedSessionId
    if (!host) {
      mountedSessionId = null
      return
    }
    if (ptyId) {
      const terminal = surfaces.terminals.get(ptyId)
      if (terminal?.element && host.contains(terminal.element)) {
        host.replaceChildren()
      }
    }
    mountedSessionId = null
  }

  async function waitHostSize(tries = 24): Promise<boolean> {
    let lastW = 0
    let lastH = 0
    let stable = 0
    for (let i = 0; i < tries; i++) {
      const host = activeSurfaceHost
      if (surfaces.hostReady(host)) {
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
    return surfaces.hostReady(activeSurfaceHost)
  }
  async function restoreTerminal(id: string, tabId: string): Promise<void> {
    const existing = surfaces.terminals.get(id)
    if (existing) return
    if (!api) throw new Error('Terminal API not available')
    bridge.restoringIds.add(id)
    const terminal = surfaces.createSurface(id, 80, 24, getFontFamily(), EDITOR_FONT_SIZE)
    bridge.resetSequence(id)
    try {
      const replay = await api.subscribe(id, 0)
      if (replay.truncatedBeforeSequence !== undefined) {
        terminal.write('\x1b[90m[earlier terminal output is no longer available]\x1b[0m\r\n')
      }
      for (const event of replay.events) applyHostEvent(event)
      const pending = bridge.drainPending(id)
      for (const event of pending) applyHostEvent(event)
      store.applyTabPatch(tabId, {
        cwd: replay.session.cwd,
        shell: replay.session.shell,
        exited: replay.session.status === 'exited',
      })
    } catch (err) {
      surfaces.disposeSurface(id)
      bridge.cleanupSession(id)
      throw err
    } finally {
      bridge.restoringIds.delete(id)
    }
  }

  async function addTerminal(
    cwd = app.activeProject?.path,
    projectId = currentProjectId,
  ): Promise<void> {
    if (!cwd || !projectId || !api) return
    if (app.mode !== 'terminal') return
    const createKey = `${projectId}:shell`
    if (bridge.creatingFor.has(createKey)) return
    bridge.creatingFor.add(createKey)
    store.error = ''
    try {
      await waitHostSize()
      try { await document.fonts?.ready } catch { /* ignore */ }
      const seed = surfaces.measureHost()
      const created = await api.create(cwd, seed.cols, seed.rows, {
        projectId,
        purpose: 'terminal',
      })
      store.seedTabForNewPty(created.id, created.cwd, created.shell)
      bridge.tabByPtyId.set(created.id, created.id)
      surfaces.createSurface(created.id, seed.cols, seed.rows, getFontFamily(), EDITOR_FONT_SIZE)
      bridge.resetSequence(created.id)
      const pending = bridge.drainPending(created.id)
      for (const event of pending) applyHostEvent(event)
      store.activeId = created.id
      await activateTab(created.id)
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err)
    } finally {
      bridge.creatingFor.delete(createKey)
    }
  }

  async function activateTab(tabId: string): Promise<void> {
    if (!store.tabs.some((tab) => tab.id === tabId)) return
    store.activeId = tabId
    await tick()
    const tab = store.findTab(tabId)
    if (!tab) return
    if (surfaces.terminals.has(tabId)) {
      await mountActiveSurface(tabId)
    } else {
      unmountActiveSurface()
    }
    void scrollToBottom(false)
  }

  async function restartActiveShell(): Promise<void> {
    const tab = activeTab()
    if (!tab || !api) return
    store.error = ''
    const oldPtyId = tab.id
    const cwd = tab.cwd || app.activeProject?.path
    const projectId = currentProjectId
    if (!cwd || !projectId) {
      store.error = 'Cannot restart shell \u2013 no working directory.'
      return
    }
    unmountActiveSurface()
    surfaces.disposeSurface(oldPtyId)
    bridge.cleanupSession(oldPtyId)
    cancelStaleTimer(oldPtyId)
    cancelIdleFinalize(oldPtyId)
    try {
      await api.kill(oldPtyId).catch(() => {})
    } catch { /* already gone */ }
    const savedBlocks = [...tab.blocks]
    const savedHistory = [...tab.history]
    const savedComposer = tab.composer
    store.removeTab(oldPtyId)
    try {
      await waitHostSize()
      try { await document.fonts?.ready } catch { /* ignore */ }
      const seed = surfaces.measureHost()
      const created = await api.create(cwd, seed.cols, seed.rows, {
        projectId,
        purpose: 'terminal',
      })
      const newTab = store.seedTabForNewPty(created.id, created.cwd, created.shell)
      bridge.tabByPtyId.set(created.id, created.id)
      store.applyTabPatch(newTab.id, {
        blocks: savedBlocks,
        history: savedHistory,
        composer: savedComposer,
      })
      surfaces.createSurface(created.id, seed.cols, seed.rows, getFontFamily(), EDITOR_FONT_SIZE)
      bridge.resetSequence(created.id)
      const pending = bridge.drainPending(created.id)
      for (const event of pending) applyHostEvent(event)
      store.activeId = created.id
      await activateTab(created.id)
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err)
    }
  }

  async function closeTab(tabId: string): Promise<void> {
    if (!api) return
    const tab = store.findTab(tabId)
    if (!tab) return
    if (mountedSessionId === tabId) unmountActiveSurface()
    surfaces.disposeSurface(tabId)
    bridge.cleanupSession(tabId)
    cancelStaleTimer(tabId)
    cancelIdleFinalize(tabId)
    store.removeTab(tabId)
    try { await api.kill(tabId) } catch { /* already gone */ }
    if (store.activeId === tabId || !store.tabs.some((t) => t.id === store.activeId)) {
      store.activeId = store.tabs[0]?.id ?? null
      if (store.activeId) await activateTab(store.activeId)
    }
  }
  async function connectSshByName(name: string): Promise<void> {
    if (!api) return
    try {
      const { hosts } = await listSsh()
      const match = hosts.find((h: SshHostInfo) => h.name.toLowerCase() === name.toLowerCase() || h.host.toLowerCase() === name.toLowerCase())
      if (match) await launchSshHost(match)
      else store.error = `SSH host "${name}" not found`
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err)
    }
  }

  function onSshConnectEvent(e: Event): void {
    const detail = (e as CustomEvent<{ name?: string; host?: string }>).detail
    const target = detail?.name || detail?.host
    if (target) void connectSshByName(target)
  }

  async function launchSshHost(host: SshHostInfo): Promise<void> {
    if (!api || !app.activeProject) return
    store.error = ''
    const createKey = `ssh:${host.host}`
    if (bridge.creatingFor.has(createKey)) return
    bridge.creatingFor.add(createKey)
    try {
      const cwd = app.activeProject.path
      const seed = surfaces.measureHost()
      const created = await api.create(cwd, seed.cols, seed.rows, {
        projectId: currentProjectId ?? undefined,
        purpose: 'terminal',
      })
      const newTab = store.seedTabForNewPty(created.id, created.cwd, created.shell)
      bridge.tabByPtyId.set(created.id, created.id)
      store.applyTabPatch(created.id, { title: `ssh:${host.host}` })
      surfaces.createSurface(created.id, seed.cols, seed.rows, getFontFamily(), EDITOR_FONT_SIZE)
      bridge.resetSequence(created.id)
      store.activeId = created.id
      await activateTab(created.id)

      const sshArgs: string[] = []
      if (host.user) sshArgs.push(`-l ${host.user}`)
      if (host.port && host.port !== 22) sshArgs.push(`-p ${host.port}`)
      if (host.identityFile) sshArgs.push(`-i "${host.identityFile}"`)
      sshArgs.push(host.hostname || host.host)

      const sshCmd = `ssh ${sshArgs.join(' ')}`

      const block: CommandBlock = {
        id: uid(),
        sessionId: created.id,
        command: sshCmd,
        cwd: created.cwd,
        shell: created.shell,
        state: 'running',
        startedAt: Date.now(),
        output: '',
        isLiveSurface: true,
      }

      store.applyTabPatch(created.id, {
        blocks: [block],
        runningCommandId: block.id,
      })
      bridge.blockByPtyId.set(created.id, block.id)

      await new Promise<void>((r) => setTimeout(r, 150))
      const term = surfaces.terminals.get(created.id)
      if (term) { term.reset(); term.clear(); }
      await api.write(created.id, `${sshCmd}\r\n`)
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err)
    } finally {
      bridge.creatingFor.delete(createKey)
    }
  }

  function pushTabHistory(tab: TerminalTab, text: string): void {
    const current = tab.history.length > 0 ? tab.history : loadHistory()
    const updated = pushHistory(current, text)
    store.applyTabPatch(tab.id, {
      history: updated,
      historyIndex: -1,
      historyDraft: '',
    })
  }

  function applyComposerText(tabId: string, text: string, el: HTMLTextAreaElement | undefined): void {
    store.applyTabPatch(tabId, { composer: text })
    if (el) {
      el.value = text
      const pos = text.length
      el.setSelectionRange(pos, pos)
      void tick().then(() => el.focus())
    }
  }

  function historyOlder(tab: TerminalTab): void {
    const list = tab.history.length > 0 ? tab.history : loadHistory()
    if (list.length === 0) return
    if (tab.history.length !== list.length) {
      store.applyTabPatch(tab.id, { history: list })
    }
    if (tab.historyIndex < 0) {
      store.applyTabPatch(tab.id, { historyDraft: tab.composer, historyIndex: list.length - 1 })
      applyComposerText(tab.id, list[list.length - 1] ?? '', composerEl)
    } else if (tab.historyIndex > 0) {
      store.applyTabPatch(tab.id, { historyIndex: tab.historyIndex - 1 })
      applyComposerText(tab.id, list[tab.historyIndex - 1] ?? '', composerEl)
    }
  }

  function historyNewer(tab: TerminalTab): void {
    if (tab.historyIndex < 0) return
    const list = tab.history.length > 0 ? tab.history : loadHistory()
    if (tab.historyIndex < list.length - 1) {
      store.applyTabPatch(tab.id, { historyIndex: tab.historyIndex + 1 })
      applyComposerText(tab.id, list[tab.historyIndex + 1] ?? '', composerEl)
      return
    }
    store.applyTabPatch(tab.id, { historyIndex: -1 })
    applyComposerText(tab.id, tab.historyDraft, composerEl)
  }
  async function runComposer(): Promise<void> {
    const tab = activeTab()
    if (!tab) return
    if (tab.runningCommandId) return
    const liveText = (composerEl?.value ?? '').replace(/\r\n/g, '\n').trimEnd()
    const text = liveText || tab.composer.replace(/\r\n/g, '\n').trimEnd()
    if (!text) return

    pushTabHistory(tab, text)

    const block: CommandBlock = {
      id: uid(),
      sessionId: tab.id,
      command: text,
      cwd: tab.cwd,
      shell: tab.shell,
      state: 'running',
      startedAt: Date.now(),
      output: '',
      isLiveSurface: true,
      isStreamFollow: detectStreamFollow(text),
    }
    store.applyTabPatch(tab.id, {
      blocks: [...tab.blocks, block],
      runningCommandId: block.id,
      composer: '',
    })
    if (composerEl) composerEl.value = ''
    bridge.blockByPtyId.set(tab.id, block.id)
    bridge.liveOutputByPtyId.delete(tab.id)
    const term = surfaces.terminals.get(tab.id); if (term) { term.reset(); term.clear(); term.write('\x1b[2J\x1b[3J\x1b[H'); }
    bridge.lastPtyDataAt.set(tab.id, Date.now())
    startStaleTimer(tab.id, block.id)
    armIdleFinalize(tab.id, block.id)
    if (store.activeId === tab.id) {
      await tick()
      void mountActiveSurface(tab.id)
      void scrollToBottom(true)
    }

    if (!api) {
      const startedAt = Date.now()
      setTimeout(() => {
        const current = activeTab()
        if (!current) return
        const existing = current.blocks.find((b) => b.id === block.id)
        if (!existing || existing.state !== 'running') return
        const mockOutput = text === 'docker compose ps'
          ? 'NAME                IMAGE             COMMAND                  SERVICE   CREATED       STATUS\nnew_sidbm-app-1      new_sidbm-app      "sidbm-entrypoint \u2026"    app       46 hours ago  Up 21 hours\nnew_sidbm-mysql-1    mysql:8.4          "docker-entrypoint\u2026"    mysql     7 days ago    Up 47 hours\n'
          : `[preview] Command "${text}" finished (no backend).\n`
        store.applyBlockUpdate(current.id, block.id, {
          state: 'success',
          exitCode: 0,
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          isLiveSurface: false,
          output: mockOutput,
        })
        store.applyTabPatch(current.id, { runningCommandId: null })
        cancelStaleTimer(current.id)
        cancelIdleFinalize(current.id)
        bridge.blockByPtyId.delete(tab.id)
        if (mountedSessionId === current.id) unmountActiveSurface()
        void scrollToBottom(true)
      }, 450)
      return
    }

    if (tab.exited) {
      store.error = 'This shell session has exited \u2013 click + to start a new terminal.'
      store.applyBlockUpdate(tab.id, block.id, {
        state: 'failed',
        exitCode: 1,
        finishedAt: Date.now(),
        durationMs: Date.now() - block.startedAt,
        isLiveSurface: false,
      })
      store.applyTabPatch(tab.id, { runningCommandId: null })
      cancelStaleTimer(tab.id)
      cancelIdleFinalize(tab.id)
      bridge.blockByPtyId.delete(tab.id)
      return
    }

    const payload = text.endsWith('\n') ? text.replace(/\r?\n/g, '\r\n') : `${text}\r\n`
    try {
      await api.write(tab.id, payload)
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err)
      store.applyBlockUpdate(tab.id, block.id, {
        state: 'failed',
        exitCode: 1,
        finishedAt: Date.now(),
        durationMs: Date.now() - block.startedAt,
        isLiveSurface: false,
      })
      store.applyTabPatch(tab.id, { runningCommandId: null })
      cancelStaleTimer(tab.id)
      cancelIdleFinalize(tab.id)
      bridge.blockByPtyId.delete(tab.id)
    }
  }
  async function stopRunning(): Promise<void> {
    const tab = activeTab()
    if (!tab || !api) return
    if (!tab.runningCommandId) return
    const blockId = tab.runningCommandId
    const runningBlock = tab.blocks.find((b) => b.id === blockId)
    const wasStreamFollow = Boolean(runningBlock?.isStreamFollow)
    const sendInterrupt = (key: string): void => {
      void api.write(tab.id, key).catch((err: unknown) => {
        store.error = err instanceof Error ? err.message : String(err)
      })
    }
    sendInterrupt('\x03')
    setTimeout(() => {
      const current = activeTab()
      if (!current || current.id !== tab.id) return
      if (!current.runningCommandId) return
      sendInterrupt('\x03')
    }, 1500)
    setTimeout(() => {
      const current = activeTab()
      if (!current || current.id !== tab.id) return
      const block = current.blocks.find((b) => b.id === blockId)
      if (!block || block.state !== 'running') return
      const tail = '\r\n\x1b[90m[interrupted by user]\x1b[0m\r\n'
      if (wasStreamFollow) {
        store.applyBlockUpdate(current.id, blockId, {
          state: 'failed',
          exitCode: 130,
          finishedAt: Date.now(),
          durationMs: Date.now() - block.startedAt,
          isLiveSurface: false,
          output: (block.output ?? '') + tail,
        })
        store.applyTabPatch(current.id, { runningCommandId: null })
        cancelStaleTimer(current.id)
        cancelIdleFinalize(current.id)
        bridge.blockByPtyId.delete(current.id)
        if (mountedSessionId === current.id) unmountActiveSurface()
        void scrollToBottom(true)
        void restartActiveShell()
        return
      }
      store.applyBlockUpdate(current.id, blockId, {
        state: 'failed',
        exitCode: 130,
        finishedAt: Date.now(),
        durationMs: Date.now() - block.startedAt,
        isLiveSurface: false,
        output: (block.output ?? '') + tail,
      })
      store.applyTabPatch(current.id, { runningCommandId: null })
      cancelStaleTimer(current.id)
      cancelIdleFinalize(current.id)
      bridge.blockByPtyId.delete(current.id)
      if (mountedSessionId === current.id) unmountActiveSurface()
      void scrollToBottom(true)
    }, 4000)
  }

    async function sendProcessInput(): Promise<void> {
    const tab = activeTab()
    if (!tab || !api || !tab.runningCommandId) return
    const text = (composerEl?.value ?? tab.composer).replace(/\r\n/g, '\n')
    const payload = text ? `${text}\r\n` : '\r\n'
    store.applyTabPatch(tab.id, { composer: '' })
    if (composerEl) composerEl.value = ''
    try {
      await api.write(tab.id, payload)
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err)
    }
  }

  function onComposerKeydown(event: KeyboardEvent): void {
    const tab = activeTab()
    if (!tab) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (tab.runningCommandId) {
        void sendProcessInput()
      } else {
        void runComposer()
      }
      return
    }
    if (event.key === 'c' && event.ctrlKey && tab.runningCommandId) {
      event.preventDefault()
      void stopRunning()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const el = composerEl
      if (!el) return
      const pos = el.selectionStart ?? 0
      if (canBrowseHistory(tab.composer, pos, tab.historyIndex, event.key)) {
        event.preventDefault()
        if (event.key === 'ArrowUp') historyOlder(tab)
        else historyNewer(tab)
      }
    }
  }

  function onComposerInput(): void {
    const el = composerEl
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  function onStageScroll(): void {
    const el = stageEl
    if (!el) return
    const tolerance = 32
    stickBottom = el.scrollHeight - el.scrollTop - el.clientHeight < tolerance
  }

  async function scrollToBottom(force = false): Promise<void> {
    if (!stickBottom && !force) return
    await tick()
    const el = stageEl
    if (el) el.scrollTop = el.scrollHeight
  }

  function jumpToBottom(): void {
    stickBottom = true
    void scrollToBottom(true)
  }
  async function switchProject(projectId: string, cwd: string): Promise<void> {
    if (!api) return
    currentProjectId = projectId
    store.error = ''
    unmountActiveSurface()
    const existing = [...store.tabs]
    store.tabs = []
    store.activeId = null
    for (const tab of existing) {
      await api.kill(tab.id).catch(() => {})
      surfaces.disposeSurface(tab.id)
      bridge.cleanupSession(tab.id)
      cancelStaleTimer(tab.id)
      cancelIdleFinalize(tab.id)
    }
    let liveSessions: Awaited<ReturnType<typeof api.list>> = []
    try {
      liveSessions = await api.list(projectId, 'terminal')
    } catch {
      liveSessions = []
    }
    for (const session of liveSessions) {
      store.seedTabForNewPty(session.id, session.cwd, session.shell)
      bridge.tabByPtyId.set(session.id, session.id)
      try {
        await restoreTerminal(session.id, session.id)
      } catch {
        store.removeTab(session.id)
        bridge.tabByPtyId.delete(session.id)
      }
    }
    if (store.tabs.length === 0) {
      await addTerminal(cwd, projectId)
      return
    }
    store.activeId = store.tabs[0]!.id
    await activateTab(store.activeId)
  }

  async function onTerminalVisible(): Promise<void> {
    if (destroyed || app.mode !== 'terminal') return
    await tick()
    await waitHostSize()
    if (destroyed || app.mode !== 'terminal') return
    if (store.activeId) await activateTab(store.activeId)
    else if (store.tabs.length === 0 && app.activeProject && currentProjectId) {
      await addTerminal(app.activeProject.path, currentProjectId)
    }
  }

  $effect(() => {
    const projectId = app.activeProjectId
    const cwd = app.activeProject?.path
    if (!projectId || !cwd) return
    untrack(() => void switchProject(projectId, cwd))
  })

  $effect(() => {
    if (app.mode !== 'terminal') {
      unmountActiveSurface()
      return
    }
    untrack(() => void onTerminalVisible())
  })

  $effect(() => {
    const family = getFontFamily()
    void app.ui.uiZoom
    for (const terminal of surfaces.terminals.values()) {
      terminal.options.fontFamily = family
      terminal.options.fontSize = EDITOR_FONT_SIZE
      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1))
      } catch { /* not yet mounted */ }
    }
    if (mountedSessionId) {
      untrack(() => {
        requestAnimationFrame(() => refitUntilStable())
      })
    }
  })

  $effect(() => {
    const tabId = store.activeId
    if (!tabId) return
    if (!store.tabs.some((t) => t.id === tabId)) return
    untrack(() => void activateTab(tabId))
    void tick().then(() => {
      composerEl?.focus({ preventScroll: true })
    })
  })

  $effect(() => {
    const tab = activeTab()
    if (!tab) return
    void tab.blocks.length
    if (mountedSessionId) return
    void scrollToBottom(false)
  })

  $effect(() => {
    const host = activeSurfaceHost
    const obs = resizeObserver
    if (!host || !obs) return
    obs.observe(host)
    return () => obs.unobserve(host)
  })

  onMount(() => {
    if (!api) return
    void api.pathComplete?.('').catch(() => {})
    const tickHandle = setInterval(() => {
      nowTick = Date.now()
    }, 500)
    const offData = api.onData((event) => {
      if (event.purpose !== 'terminal') return
      const hostEvent: TerminalHostEvent = { type: 'data', ...event } as any
      if (bridge.restoringIds.has(event.id) || !surfaces.terminals.has(event.id)) {
        bridge.queueHostEvent(hostEvent)
        return
      }
      applyHostEvent(hostEvent)
    })
    const offExit = api.onExit((event) => {
      if (event.purpose !== 'terminal') return
      const hostEvent: TerminalHostEvent = { type: 'exit', ...event } as any
      if (bridge.restoringIds.has(event.id) || !surfaces.terminals.has(event.id)) {
        bridge.queueHostEvent(hostEvent)
        return
      }
      applyHostEvent(hostEvent)
    })
    const offShellMarker = api.onShellMarker((event) => {
      if (event.purpose !== 'terminal') return
      const hostEvent: TerminalHostEvent = { type: 'shell_marker', ...event } as any
      if (bridge.restoringIds.has(event.id) || !surfaces.terminals.has(event.id)) {
        bridge.queueHostEvent(hostEvent)
        return
      }
      applyHostEvent(hostEvent)
    })
    window.addEventListener('enpiistudio:terminal-ssh', onSshConnectEvent)
    resizeObserver = new ResizeObserver(() => refitUntilStable())
    return () => {
      offData()
      offExit()
      offShellMarker()
      window.removeEventListener('enpiistudio:terminal-ssh', onSshConnectEvent)
      resizeObserver?.disconnect()
      clearInterval(tickHandle)
    }
  })

  onDestroy(() => {
    destroyed = true
    for (const timer of staleRunTimers.values()) clearTimeout(timer)
    staleRunTimers.clear()
    for (const timer of idleFinalizeTimers.values()) clearTimeout(timer)
    idleFinalizeTimers.clear()
    surfaces.destroy()
    bridge.destroy()
    store.clear()
    mountedSessionId = null
  })
</script>


<div
  class="grid h-full min-h-0 grid-rows-[36px_minmax(0,1fr)_auto] bg-transparent"
  role="region"
  aria-label="Terminal stage"
>
  <!-- Top Header / Tab bar -->
  <header
    class="relative z-30 flex h-9 shrink-0 items-center gap-0 overflow-x-auto border-b border-white/5 bg-transparent px-2.5"
    role="tablist"
    aria-label="Terminal sessions"
  >
    {#each tabs as tab (tab.id)}
      {@const isActive = tab.id === activeId}
      <div
        class="flex h-7 items-center gap-1 rounded-md border px-2 transition-colors {isActive
          ? 'border-border-subtle bg-black/35 text-white'
          : 'border-transparent text-studio-text-dim hover:text-white'}"
      >
        <button
          type="button"
          class="flex items-center gap-1.5 font-mono text-xs"
          role="tab"
          aria-selected={isActive}
          title={tab.cwd || tab.title}
          onclick={() => {
            store.activeId = tab.id
            void activateTab(tab.id)
          }}
        >
          <span class="size-1.5 rounded-lg {tab.exited ? 'bg-studio-text-dim' : tab.runningCommandId ? 'bg-studio-gold animate-pulse' : 'bg-studio-success'}"></span>
          {tab.title}
        </button>
        <button
          type="button"
          class="grid size-5 place-items-center rounded text-studio-text-dim hover:bg-white/10 hover:text-studio-error"
          aria-label={`Close ${tab.title}`}
          title={`Close ${tab.title}`}
          onclick={(e) => {
            e.stopPropagation()
            void closeTab(tab.id)
          }}
        ><Icon name="close" size={11} /></button>
      </div>
    {/each}
    <button
      type="button"
      class="ml-1 grid size-7 shrink-0 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-white"
      aria-label="New terminal"
      title="New terminal"
      onclick={() => void addTerminal(app.activeProject?.path, currentProjectId)}
    ><Icon name="plus" size={14} /></button>
    {#if activeTab()?.exited}
      <button
        type="button"
        class="ml-1 grid h-7 shrink-0 place-items-center rounded-md border border-studio-error/40 bg-studio-error/10 px-2 text-[10px] font-semibold text-studio-error hover:bg-studio-error/20"
        aria-label="Restart shell in this tab"
        title="Shell process exited ? click to spawn a fresh shell with the same working directory."
        onclick={() => void restartActiveShell()}
      >Restart shell</button>
    {/if}
  </header>

  <!-- Middle Scrollable Area: command history for active tab -->
  <div class="relative min-h-0 overflow-hidden">
    {#if error}
      <div class="absolute inset-x-0 top-2 z-10 mx-3 rounded-md border border-studio-error/40 bg-studio-error/10 px-3 py-2 font-mono text-[11px] text-studio-error">
        {error}
      </div>
    {/if}
    {#if !activeTab()}
      <div class="grid h-full place-items-center px-6 text-center text-studio-text-dim">
        <div>
          <div class="mx-auto mb-3 grid size-10 place-items-center rounded-lg bg-studio-purple text-sm font-bold text-white">E</div>
          <div class="mb-1 text-sm font-semibold text-studio-gold">No terminal session</div>
          <div class="max-w-sm text-[12px]">Open a project, then click + to start a terminal session.</div>
        </div>
      </div>
    {:else}
      {@const tab = activeTab()!}
      <div
        class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto studio-scrollbar p-3 select-text"
        bind:this={stageEl}
        onscroll={onStageScroll}
        role="log"
        aria-label="Command history"
      >
        {#each tab.blocks as block (block.id)}
          {@const isLiveXterm = block.isLiveSurface && block.state === 'running' && tab.runningCommandId === block.id && tab.id === activeId}
          <article
            class="flex shrink-0 flex-col overflow-hidden rounded-lg border border-l-2 font-mono text-xs shadow-sm transition-colors {blockLeftAccent(block.state)} {blockStatusClass(block.state)}"
            in:fly={{ y: 6, duration: 140 }}
            out:fade={{ duration: 100 }}
          >
            <!-- Metadata header -->
            <div class="flex shrink-0 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/5 px-3 py-1.5 text-xs">
              <span
                class="min-w-0 max-w-full truncate text-studio-text"
                title={block.cwd}
              >{block.cwd || '?'}</span>
              <span class="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-studio-text-dim text-[11px]">{block.shell}</span>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[11px] {stateClasses(block.state)}"
                aria-label="Status"
                title={block.isStreamFollow ? 'Long-running command ? only Stop or shell exit will end this block' : undefined}
              >
                {#if block.state === 'running'}
                  <span class="inline-flex items-center gap-1">
                    <span class="size-1.5 animate-pulse rounded-full bg-studio-gold"></span>
                    {block.isStreamFollow ? 'streaming' : 'running'}
                  </span>
                {:else}
                  {stateLabel(block.state, block.exitCode)}
                {/if}
              </span>
              {#if block.state === 'running'}
                <span class="shrink-0 text-studio-text-dim text-[11px]" data-running-elapsed>{formatDuration(nowTick - block.startedAt)}</span>
                {#if tab.runningCommandId === block.id}
                  <button
                    type="button"
                    class="ml-auto inline-flex items-center gap-1 rounded border border-studio-error/35 bg-studio-error/10 px-1.5 py-0.5 text-[11px] font-semibold text-studio-error transition-colors hover:bg-studio-error/20"
                    title={block.isStreamFollow
                      ? 'Send Ctrl+C to stop this stream-follow command'
                      : 'Send Ctrl+C to interrupt this command'}
                    aria-label="Stop running command"
                    onclick={(e) => {
                      e.stopPropagation()
                      void stopRunning()
                    }}
                  >
                    <Icon name="stop" size={10} />
                    <span>Stop</span>
                  </button>
                {/if}
              {:else if block.durationMs !== undefined}
                <span class="shrink-0 text-studio-text-dim text-[11px]">{formatDuration(block.durationMs)}</span>
              {/if}
              {#if block.finishedAt}
                <span class="shrink-0 text-studio-text-dim/70 text-[11px]">{new Date(block.finishedAt).toLocaleTimeString()}</span>
              {/if}
            </div>

            <!-- Command row -->
            <div class="flex shrink-0 items-start gap-2 px-3 py-1.5">
              <span class="grid size-5 shrink-0 select-none place-items-center rounded bg-white/10 text-xs font-bold text-studio-text-dim" aria-hidden="true">&gt;</span>
              <pre class="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-studio-text">{block.command || '?'}</pre>
            </div>

            <!-- Live xterm surface (only for the running block of active tab) -->
            {#if isLiveXterm}
              <div
                class="h-80 min-h-[220px] max-h-[500px] w-full min-w-0 flex-1 overflow-hidden border-t border-white/5 bg-black/30 p-2"
                bind:this={activeSurfaceHost}
              ></div>
            {:else if block.output}
              <!-- Output preview for completed or non-surface blocks -->
              <div class="max-h-[600px] flex-1 overflow-auto studio-scrollbar border-t border-white/5 px-3 py-2 text-xs leading-relaxed text-studio-text-dim whitespace-pre font-mono selection:bg-studio-purple/40"
              >{outputPreview(
                block.output,
                block.isStreamFollow && block.state === 'running' ? Number.POSITIVE_INFINITY : 10000,
                block.command.trim(),
              )}</div>
            {:else}
              <div class="shrink-0 border-t border-white/5 px-3 py-2 text-xs italic text-studio-text-dim/70">
                {#if block.state === 'running'}
                  Waiting for command output?
                  <span class="ml-1 inline-block w-1.5 h-3 align-middle bg-studio-gold animate-pulse"></span>
                {:else}
                  No output
                {/if}
              </div>
            {/if}
          </article>
        {/each}
        {#if tab.blocks.length === 0}
          <div class="grid place-items-center rounded-lg border border-dashed border-white/8 py-10 text-center text-[12px] text-studio-text-dim">
            <div>
              <div class="mb-1 text-studio-text">No commands yet</div>
              <div>Type a command below and press Enter to run it.</div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Jump-to-bottom FAB -->
      {#if !stickBottom && tab.blocks.length > 0}
        <button
          type="button"
          class="absolute bottom-3 left-1/2 z-[5] grid size-8 -translate-x-1/2 place-items-center rounded-full border border-white/12 bg-studio-panel text-studio-text shadow-md hover:border-studio-gold/50 hover:text-studio-gold"
          aria-label="Scroll to latest"
          title="Scroll to latest"
          onclick={jumpToBottom}
        ><Icon name="arrow-down" size={14} /></button>
      {/if}
    {/if}
  </div>

  <!-- Bottom Composer Bar -->
  <footer class="z-20 shrink-0 border-t border-border-subtle bg-studio-sidebar px-3 py-2.5">
    {#if activeTab()}
      {@const tab = activeTab()!}
      {@const running = Boolean(tab.runningCommandId)}
      <div
        class="composer-inner relative flex items-end gap-2 rounded-xl border border-border-subtle bg-studio-dark p-2.5 transition-colors focus-within:border-studio-purple/50 shadow-sm"
        role="group"
        aria-label="Terminal command composer"
      >
        <span
          class="grid size-7 shrink-0 select-none place-items-center rounded-lg bg-studio-purple/20 font-mono text-sm font-bold text-studio-purple"
          aria-hidden="true"
        >&gt;</span>
        <textarea
          class="min-h-[28px] max-h-48 flex-1 resize-none bg-transparent py-1 font-mono text-sm leading-relaxed text-studio-text outline-none placeholder:text-studio-text-dim"
          rows="1"
          bind:this={composerEl}
          placeholder={running
            ? 'Input is going to the running process... (Enter to send)'
            : 'Type a command and press Enter (Shift+Enter for newline)'}
          bind:value={tab.composer}
          onkeydown={onComposerKeydown}
          oninput={onComposerInput}
          aria-label="Terminal command"
          title="Enter to run • Shift+Enter for newline • ↑/↓ for history"
        ></textarea>
        <Button
          variant={running ? 'danger' : 'primary'}
          size="sm"
          disabled={!running && !tab.composer.trim()}
          aria-label={running ? 'Stop running process (Ctrl+C)' : 'Run command'}
          title={running ? 'Send Ctrl+C to running process' : 'Run command (Enter)'}
          onclick={() => (running ? void stopRunning() : void runComposer())}
        >
          {#if running}
            <Icon name="stop" size={14} />
            <span>Stop</span>
          {:else}
            <Icon name="send" size={14} />
            <span>Run</span>
          {/if}
        </Button>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-studio-text-dim">
        <div class="flex items-center gap-1.5 min-w-0 truncate font-mono">
          <span class="truncate font-medium text-studio-text-body" title={tab.cwd}>{tab.cwd || '?'}</span>
          <span class="text-white/20">•</span>
          <span class="shrink-0 text-studio-lavender-muted">{tab.shell}</span>
        </div>
        <div class="flex items-center gap-2 font-mono text-[10px] text-studio-text-dim/80 shrink-0">
          <span><kbd class="rounded bg-white/8 px-1 py-0.5 border border-white/10 text-studio-text-body font-sans">Enter</kbd> run</span>
          <span class="text-white/20">•</span>
          <span><kbd class="rounded bg-white/8 px-1 py-0.5 border border-white/10 text-studio-text-body font-sans">Shift+Enter</kbd> newline</span>
          <span class="text-white/20">•</span>
          <span><kbd class="rounded bg-white/8 px-1 py-0.5 border border-white/10 text-studio-text-body font-sans">↑/↓</kbd> history</span>
        </div>
      </div>
    {/if}
  </footer>
</div>

<!-- xterm injects .xterm; host needs height chain -->
<style>
  :global(.xterm) {
    height: 100%;
    width: 100%;
  }
  :global(.xterm-viewport) {
    overflow-y: auto !important;
    scrollbar-width: thin;
    scrollbar-color: var(--color-studio-scrollbar, rgba(255, 255, 255, 0.18)) transparent;
  }
  :global(.studio-scrollbar) {
    scrollbar-width: thin;
    scrollbar-color: var(--color-studio-scrollbar, rgba(255, 255, 255, 0.18)) transparent;
  }
  :global(.xterm-viewport::-webkit-scrollbar),
  :global(.studio-scrollbar::-webkit-scrollbar) {
    width: 6px !important;
    height: 6px !important;
  }
  :global(.xterm-viewport::-webkit-scrollbar-track),
  :global(.xterm-viewport::-webkit-scrollbar-corner),
  :global(.xterm-viewport::-webkit-resizer),
  :global(.studio-scrollbar::-webkit-scrollbar-track),
  :global(.studio-scrollbar::-webkit-scrollbar-corner),
  :global(.studio-scrollbar::-webkit-resizer) {
    background: transparent !important;
  }
  :global(.xterm-viewport::-webkit-scrollbar-thumb),
  :global(.studio-scrollbar::-webkit-scrollbar-thumb) {
    background: var(--color-studio-scrollbar, rgba(255, 255, 255, 0.18)) !important;
    border-radius: 99px !important;
    border: 2px solid transparent !important;
    background-clip: padding-box !important;
  }
  :global(.xterm-viewport::-webkit-scrollbar-thumb:hover),
  :global(.studio-scrollbar::-webkit-scrollbar-thumb:hover) {
    background: var(--color-studio-scrollbar-hover, rgba(255, 255, 255, 0.28)) !important;
    background-clip: padding-box !important;
    border: 2px solid transparent !important;
  }
  :global(.xterm .scrollbar),
  :global(.xterm .scrollbar.vertical),
  :global(.xterm .scrollbar.horizontal),
  :global(.xterm .xterm-scrollable-element > .scrollbar) {
    width: 6px !important;
    height: 6px !important;
    background: transparent !important;
  }
  :global(.xterm .scrollbar .slider),
  :global(.xterm .scrollbar.vertical .slider),
  :global(.xterm .scrollbar.horizontal .slider),
  :global(.xterm .xterm-scrollable-element .slider) {
    width: 6px !important;
    border-radius: 99px !important;
    background: var(--color-studio-scrollbar, rgba(255, 255, 255, 0.18)) !important;
    left: 0px !important;
  }
  :global(.xterm .scrollbar .slider:hover),
  :global(.xterm .xterm-scrollable-element .slider:hover) {
    background: var(--color-studio-scrollbar-hover, rgba(255, 255, 255, 0.28)) !important;
  }
</style>
