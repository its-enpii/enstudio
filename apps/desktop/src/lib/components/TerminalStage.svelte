<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { listSsh, type SshHostInfo } from '../enpii'
  import { state as app } from '../store.svelte'
  import { xtermTheme } from '../theme'
  import { Dropdown, type DropdownItem } from './ui'

  type TerminalTab = { id: string; title: string; exited: boolean }
  type PaneIds = [string | null, string | null]
  type TerminalWorkspace = { tabs: TerminalTab[]; activeId: string | null; paneIds: PaneIds; paneTabs: [string[], string[]]; focusedPane: 0 | 1; nextTitle: number }

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
  let error = $state('')
  let currentProjectId: string | null = null
  const workspaces = new Map<string, TerminalWorkspace>()
  let destroyed = false
  let resizeObserver: ResizeObserver | undefined
  const terminals = new Map<string, Terminal>()
  const fitAddons = new Map<string, FitAddon>()
  const terminalSizes = new Map<string, { cols: number; rows: number }>()
  const pendingData = new Map<string, string>()
  const creatingFor = new Set<string>()
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

  function fitPane(pane: 0 | 1, immediate = false): void {
    const id = paneIds[pane]
    const host = hostForPane(pane)
    if (!id || !host || host.clientWidth <= 0 || host.clientHeight <= 0) return
    const fit = fitAddons.get(id)
    const terminal = terminals.get(id)
    if (!fit || !terminal) return
    const apply = () => {
      try {
        fit.fit()
        const previous = terminalSizes.get(id)
        if (previous?.cols === terminal.cols && previous.rows === terminal.rows) return
        terminalSizes.set(id, { cols: terminal.cols, rows: terminal.rows })
        void api.resize(id, terminal.cols, terminal.rows)
      } catch {
        /* hidden or not mounted yet */
      }
    }
    // Debounce — TUI CLIs (Codex etc.) thrash on rapid resize.
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
      }, 80),
    )
  }

  function fitVisible(immediate = false): void {
    fitPane(0, immediate)
    fitPane(1, immediate)
  }

  async function mountPane(pane: 0 | 1): Promise<void> {
    const id = paneIds[pane]
    const host = hostForPane(pane)
    if (!host) return
    if (!id) {
      host.replaceChildren()
      return
    }
    const terminal = terminals.get(id)
    if (!terminal) return
    if (!terminal.element) terminal.open(host)
    else if (host.firstElementChild !== terminal.element) host.replaceChildren(terminal.element)
    // Double rAF: layout settles after open before fit (kills tiny→full flash)
    fitPane(pane, true)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    fitPane(pane, true)
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
  }

  let sshHosts = $state<SshHostInfo[]>([])
  let sshConfigPath = $state('')
  const sshMenuItems = $derived<DropdownItem[]>([
    ...sshHosts.map((h) => ({
      id: h.name,
      label: h.name,
      description: `${h.user ? `${h.user}@` : ''}${h.host}:${h.port}`,
    })),
    ...(sshHosts.length ? [{ id: '_sep', label: '', separator: true }] : []),
    {
      id: '_edit',
      label: 'Edit ssh.json…',
      description: sshConfigPath || '~/.enpiistudio/ssh.json',
    },
  ])

  async function refreshSshHosts(): Promise<void> {
    try {
      const data = await listSsh()
      sshHosts = data.hosts ?? []
      sshConfigPath = data.configPath ?? ''
    } catch {
      sshHosts = []
    }
  }

  async function onSshMenuSelect(id: string): Promise<void> {
    if (id === '_edit') {
      const path = sshConfigPath || (await listSsh().then((d) => d.configPath).catch(() => ''))
      if (path) void window.enpiistudio.shell.openPath(path)
      return
    }
    const host = sshHosts.find((h) => h.name === id)
    if (host) void launchSshHost(host)
  }

  function measureHost(pane: 0 | 1): { cols: number; rows: number } {
    const host = hostForPane(pane)
    // JetBrains Mono 12 / lineHeight 1.25
    const cellW = 7.2
    const cellH = 15
    const w = host?.clientWidth ?? 0
    const h = host?.clientHeight ?? 0
    // Prefer real host size; only fall back when not laid out yet
    const cols = Math.max(80, Math.floor((w > 40 ? w : 900) / cellW))
    const rows = Math.max(24, Math.floor((h > 40 ? h : 500) / cellH))
    return { cols, rows }
  }

  /** Wait until pane host has real layout (avoids tiny seed → jump-fit). */
  async function waitHostSize(pane: 0 | 1, tries = 12): Promise<void> {
    for (let i = 0; i < tries; i++) {
      const host = hostForPane(pane)
      if (host && host.clientWidth > 40 && host.clientHeight > 40) return
      await tick()
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
  }

  async function addTerminal(
    cwd = app.activeProject?.path,
    projectId = currentProjectId,
    pane: 0 | 1 = focusedPane,
    opts?: { command?: string; args?: string[]; title?: string },
  ): Promise<void> {
    if (!cwd) return
    if (!projectId) return
    // Allow parallel vendor launches — key by project+command
    const createKey = `${projectId}:${opts?.command ?? 'shell'}:${opts?.title ?? ''}`
    if (creatingFor.has(createKey)) return
    creatingFor.add(createKey)
    const workspace = workspaceFor(projectId)
    const targetPane: 0 | 1 = pane === 1 || paneIds[1] ? pane : 0
    error = ''
    try {
      await waitHostSize(targetPane)
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
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 12,
        lineHeight: 1.25,
        scrollback: 5_000,
        // Disable bold → bright swap thrash some TUIs re-render on.
        drawBoldTextInBrightColors: false,
        theme: { ...xtermTheme },
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.onData((data) => void api.write(created.id, data))
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

  async function closeSplit(): Promise<void> {
    const moved = paneIds[1]
    if (moved) {
      paneTabs = [ [...paneTabs[0], moved], paneTabs[1].filter((id) => id !== moved) ]
    }
    paneIds[1] = null
    paneIds = [...paneIds]
    focusedPane = 0
    activeId = paneIds[0]
    syncWorkspace()
    secondaryHost?.replaceChildren()
    await tick()
    await mountPane(0)
    terminals.get(activeId ?? '')?.focus()
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
    primaryHost?.replaceChildren()
    secondaryHost?.replaceChildren()
    await tick()
    if (destroyed || currentProjectId !== projectId) return
    if (paneIds[0] && terminals.has(paneIds[0])) {
      await mountPane(0)
      await mountPane(1)
      if (activeId) await activateTerminal(activeId, focusedPane)
    }
    else if (tabs.length === 0) await addTerminal(cwd, projectId)
  }

  $effect(() => {
    const projectId = app.activeProjectId
    const cwd = app.activeProject?.path
    if (!projectId || !cwd) return
    untrack(() => void switchProject(projectId, cwd))
  })

  onMount(() => {
    const offData = api.onData(({ id, data }) => {
      const terminal = terminals.get(id)
      if (terminal) terminal.write(data)
      else pendingData.set(id, `${pendingData.get(id) ?? ''}${data}`)
    })
    const offExit = api.onExit(({ id, exitCode }) => {
      for (const workspace of workspaces.values()) {
        const tab = workspace.tabs.find((item) => item.id === id)
        if (tab) tab.exited = true
      }
      terminals.get(id)?.write(`\r\n\x1b[90m[process exited ${exitCode}]\x1b[0m\r\n`)
    })
    resizeObserver = new ResizeObserver(() => fitVisible(false))
    return () => {
      offData()
      offExit()
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
    for (const id of terminals.keys()) void api.kill(id)
    for (const terminal of terminals.values()) terminal.dispose()
    terminals.clear()
    workspaces.clear()
  })
</script>


<div class="relative flex h-full min-h-0 flex-col p-0">
  <div class="absolute right-0 top-0 z-[6] flex items-center justify-end gap-2 px-2 pt-1.5">
    <button
      type="button"
      class="rounded px-1.5 py-1 font-mono text-[13px] text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
      aria-label="Split terminal"
      title="Split terminal"
      onclick={() => void splitTerminal()}>▥</button
    >
    <Dropdown
      items={sshMenuItems}
      label="SSH"
      align="end"
      disabled={!app.activeProject}
      onSelect={(id) => void onSshMenuSelect(id)}
      class="!inline-flex"
    >
      {#snippet trigger({ open, toggle })}
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-white/12 bg-white/5 px-2.5 py-1 text-xs text-studio-text-dim hover:border-studio-gold/45 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Open SSH host"
          disabled={!app.activeProject}
          onclick={(e) => {
            e.stopPropagation()
            if (!open) void refreshSshHosts()
            toggle()
          }}
        >
          SSH ▾
        </button>
      {/snippet}
    </Dropdown>
  </div>
  <section
    class="relative min-h-0 flex-1 overflow-hidden {paneIds[1]
      ? 'grid grid-cols-2'
      : 'grid grid-cols-1'}"
  >
    {#if error}
      <div class="absolute inset-x-0 top-10 z-10 p-3.5 font-mono text-[11px] text-studio-error">{error}</div>
    {/if}
    {#if tabs.length === 0 && !error}
      <button
        type="button"
        class="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-studio-purple/42 bg-studio-purple/18 px-3 py-2 text-[11px] text-studio-lavender-muted"
        onclick={() => void addTerminal()}>New Terminal</button
      >
    {/if}
    <div
      class="grid min-h-0 min-w-0 grid-rows-[36px_minmax(0,1fr)] overflow-hidden {focusedPane === 0
        ? 'ring-1 ring-inset ring-studio-purple/40'
        : ''}"
      onfocusin={() => void focusPane(0)}
    >
      <div
        class="flex min-h-9 min-w-0 items-stretch overflow-x-auto border-b border-border-subtle bg-studio-panel/95"
        role="tablist"
        aria-label="Primary terminal pane"
      >
        {#each paneTabs[0] as id (id)}
          {@const tab = tabs.find((item) => item.id === id)}
          {#if tab}
            <div
              class="flex items-center border-r border-white/5 {tab.id === activeId
                ? 'bg-studio-purple/20 border-b-2 border-b-studio-purple'
                : ''}"
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
                  class="flex items-center gap-1.5 px-1.5 py-2 pl-2.5 font-mono text-[10px] {tab.id === activeId
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
                class="mx-1 grid size-7 place-items-center rounded-md text-[14px] leading-none text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
                aria-label={`Close ${tab.title}`}
                onclick={() => void closeTerminal(tab.id)}>×</button
              >
            </div>
          {/if}
        {/each}
        <button
          type="button"
          class="ml-1.5 rounded px-1.5 py-1 font-mono text-base text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
          aria-label="New terminal"
          title="New terminal"
          onclick={() => void addTerminal(app.activeProject?.path, currentProjectId, 0)}>+</button
        >
      </div>
      <div class="box-border h-full min-h-0 w-full p-3" bind:this={primaryHost}></div>
    </div>
    <div
      class="min-h-0 min-w-0 overflow-hidden border-l border-white/8 {paneIds[1]
        ? 'grid grid-rows-[36px_minmax(0,1fr)]'
        : 'hidden'} {focusedPane === 1 ? 'ring-1 ring-inset ring-studio-purple/40' : ''}"
      onfocusin={() => void focusPane(1)}
    >
      <div
        class="flex min-h-9 min-w-0 items-stretch overflow-x-auto border-b border-border-subtle bg-studio-panel/95"
        role="tablist"
        aria-label="Secondary terminal pane"
      >
        {#each paneTabs[1] as id (id)}
          {@const tab = tabs.find((item) => item.id === id)}
          {#if tab}
            <div
              class="flex items-center border-r border-white/5 {tab.id === activeId
                ? 'bg-studio-purple/20 border-b-2 border-b-studio-purple'
                : ''}"
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
                  class="flex items-center gap-1.5 px-1.5 py-2 pl-2.5 font-mono text-[10px] {tab.id === activeId
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
                class="mx-1 grid size-7 place-items-center rounded-md text-[14px] leading-none text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
                aria-label={`Close ${tab.title}`}
                onclick={() => void closeTerminal(tab.id)}>×</button
              >
            </div>
          {/if}
        {/each}
        <button
          type="button"
          class="ml-1.5 rounded px-1.5 py-1 font-mono text-base text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
          aria-label="New terminal in split pane"
          title="New terminal in split pane"
          onclick={() => void addTerminal(app.activeProject?.path, currentProjectId, 1)}>+</button
        >
        <button
          type="button"
          class="mx-1 rounded px-1 py-1 font-mono text-[10px] text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
          aria-label="Close split pane"
          title="Close split pane"
          onclick={(event) => {
            event.stopPropagation()
            void closeSplit()
          }}>×</button
        >
      </div>
      <div class="box-border h-full min-h-0 w-full p-3" bind:this={secondaryHost}></div>
    </div>
  </section>
</div>

<!-- xterm injects .xterm; host needs height chain -->
<style>
  :global(.xterm) {
    height: 100%;
  }
  :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
