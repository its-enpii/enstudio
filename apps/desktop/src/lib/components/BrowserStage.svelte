<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { state as app } from '../store.svelte'
  import { runBrowserUiEdit } from '../enpii'
  import { browserPanel, setBrowserEditJob, syncBrowserPanel } from '../browser-panel.svelte'
  import type { BrowserDownload } from '../../../electron/preload'
  import { t } from '../i18n/index.svelte'
  import { ConfirmDialog, Dropdown, TextInput } from './ui'
  import { Icon } from '../icons'
  import { classifyBrowserUrl, pageOriginLabel, suggestNavigateUrl, type PageOrigin } from '../browserOrigin'
  import {
    OUTLINE_CLEAR_JS,
    OUTLINE_HIGHLIGHT_JS,
    OUTLINE_PICK_POLL_JS,
    OUTLINE_PICK_START_JS,
    OUTLINE_PICK_STOP_JS,
    OUTLINE_SCRAPE_JS,
    type OutlineNode,
  } from '../browserOutline'

  type BrowserElement = HTMLElement & {
    canGoBack: () => boolean
    canGoForward: () => boolean
    goBack: () => void
    goForward: () => void
    reload: () => void
    loadURL: (url: string) => Promise<void>
    insertCSS: (css: string) => Promise<string>
    removeInsertedCSS: (key: string) => Promise<void>
    executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
    findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number
    stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
    getURL?: () => string
    getWebContentsId?: () => number
    openDevTools?: () => void
  }

  type BrowserTab = {
    id: string
    title: string
    url: string
    ready: boolean
    loading: boolean
    canBack: boolean
    canForward: boolean
  }

  type BrowserBookmark = { id: string; title: string; url: string }
  type BrowserHistoryEntry = { id: string; title: string; url: string; visitedAt: number }

  type BrowserWorkspace = { tabs: BrowserTab[]; activeId: string; bookmarks: BrowserBookmark[]; history: BrowserHistoryEntry[] }

  let tabs = $state<BrowserTab[]>([])
  let activeId = $state('')
  let input = $state<HTMLInputElement>()
  let address = $state('')
  let findOpen = $state(false)
  let findInput = $state<HTMLInputElement>()
  let findQuery = $state('')
  let findMatches = $state(0)
  let findActive = $state(0)
  let error = $state('')
  /** Follow app theme — soft color-scheme only (no paint override). */
  const pageTheme = $derived(app.ui.theme === 'light' ? 'light' : 'dark')
  let bookmarks = $state<BrowserBookmark[]>([])
  let bookmarksOpen = $state(false)
  let editingBookmarkId = $state<string | null>(null)
  let editingBookmarkTitle = $state('')
  let bookmarkRenameInput = $state<HTMLInputElement>()
  let history = $state<BrowserHistoryEntry[]>([])
  let historyOpen = $state(false)
  let historyQuery = $state('')
  let clearHistoryOpen = $state(false)
  let downloads = $state<BrowserDownload[]>([])
  let downloadsOpen = $state(false)
  let currentProjectId: string | null = null
  let currentProjectPath: string | null = null
  let webviewElements = $state<(BrowserElement | undefined)[]>([])
  let webviews = new Map<string, BrowserElement>()
  let themeKeys = new Map<string, string>()
  let cleanups = new Map<string, () => void>()
  const workspaces = new Map<string, BrowserWorkspace>()
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let loadingWorkspace = false

  /** Per-project cookie/storage isolation for webviews. */
  const browserPartition = $derived(
    app.activeProjectId ? `persist:enpii-browser-${app.activeProjectId}` : 'persist:enpii-browser',
  )
  const activeTab = $derived(tabs.find((tab) => tab.id === activeId) ?? null)
  const loading = $derived(activeTab?.loading ?? false)
  const activeBookmark = $derived(bookmarks.find((bookmark) => bookmark.url === activeTab?.url) ?? null)
  const filteredHistory = $derived(history.filter((entry) => `${entry.title} ${entry.url}`.toLowerCase().includes(historyQuery.trim().toLowerCase())))
  const activeDownloads = $derived(downloads.filter((download) => download.status === 'progressing').length)
  const pageOrigin = $derived(
    classifyBrowserUrl(activeTab?.url, { projectRoot: app.activeProject?.path }),
  ) as PageOrigin
  const originBadge = $derived(pageOriginLabel(pageOrigin))

  function pushPanel(): void {
    syncBrowserPanel({
      url: activeTab?.url ?? '',
      title: activeTab?.title ?? '',
      bookmarks,
      history,
      downloads: downloads.map((d) => ({
        id: d.id,
        filename: d.filename,
        url: d.url,
        savePath: d.savePath,
        receivedBytes: d.receivedBytes,
        totalBytes: d.totalBytes,
        status: d.status,
        startedAt: d.startedAt,
      })),
      projectRoot: app.activeProject?.path ?? '',
    })
  }

  $effect(() => {
    // Keep rail in sync whenever tab/list state changes.
    void activeId
    void activeTab?.url
    void activeTab?.title
    void bookmarks
    void history
    void downloads
    void app.activeProject?.path
    pushPanel()
  })

  const toolBtn =
    'grid size-7 place-items-center rounded-md text-[13px] text-studio-text-dim hover:bg-white/8 hover:text-studio-text disabled:opacity-40'
  const toolBtnActive = 'bg-studio-purple/20 text-studio-text'

  function newTab(): BrowserTab {
    return {
      id: crypto.randomUUID(),
      title: 'New Tab',
      url: '',
      ready: false,
      loading: false,
      canBack: false,
      canForward: false,
    }
  }

  function safeNav(view: BrowserElement | undefined, method: 'canGoBack' | 'canGoForward'): boolean {
    if (!view) return false
    try {
      return view[method]()
    } catch {
      return false
    }
  }

  function safeCall(view: BrowserElement | undefined, fn: (v: BrowserElement) => void): void {
    if (!view) return
    try {
      fn(view)
    } catch {
      /* webview not attached / not ready */
    }
  }

  function syncNav(tab: BrowserTab, view: BrowserElement): void {
    tab.canBack = safeNav(view, 'canGoBack')
    tab.canForward = safeNav(view, 'canGoForward')
  }

  function resetWebviews(): void {
    for (const cleanup of cleanups.values()) cleanup()
    cleanups.clear()
    webviews.clear()
    themeKeys.clear()
    webviewElements = []
  }

  function workspaceFor(projectId: string): BrowserWorkspace {
    const existing = workspaces.get(projectId)
    if (existing) return existing
    const tab = newTab()
    const workspace = { tabs: [tab], activeId: tab.id, bookmarks: [], history: [] }
    workspaces.set(projectId, workspace)
    return workspace
  }

  function serializeWorkspace(): BrowserWorkspace {
    return {
      tabs: tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        ready: false,
        loading: false,
        canBack: false,
        canForward: false,
      })),
      activeId,
      bookmarks: bookmarks.map((b) => ({ ...b })),
      history: history.slice(0, 200).map((h) => ({ ...h })),
    }
  }

  function parseWorkspace(raw: unknown): BrowserWorkspace | null {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const rawTabs = Array.isArray(o.tabs) ? o.tabs : []
    const tabsIn: BrowserTab[] = []
    for (const item of rawTabs) {
      if (!item || typeof item !== 'object') continue
      const t = item as Record<string, unknown>
      const id = typeof t.id === 'string' ? t.id : crypto.randomUUID()
      const url = typeof t.url === 'string' ? t.url : ''
      const title = typeof t.title === 'string' && t.title.trim() ? t.title : url || 'New Tab'
      tabsIn.push({
        id,
        title,
        url,
        ready: false,
        loading: false,
        canBack: false,
        canForward: false,
      })
    }
    if (!tabsIn.length) tabsIn.push(newTab())
    const active =
      typeof o.activeId === 'string' && tabsIn.some((t) => t.id === o.activeId)
        ? o.activeId
        : tabsIn[0].id
    const bookmarksIn: BrowserBookmark[] = []
    if (Array.isArray(o.bookmarks)) {
      for (const item of o.bookmarks) {
        if (!item || typeof item !== 'object') continue
        const b = item as Record<string, unknown>
        if (typeof b.url !== 'string' || !b.url) continue
        bookmarksIn.push({
          id: typeof b.id === 'string' ? b.id : crypto.randomUUID(),
          title: typeof b.title === 'string' && b.title.trim() ? b.title : b.url,
          url: b.url,
        })
      }
    }
    const historyIn: BrowserHistoryEntry[] = []
    if (Array.isArray(o.history)) {
      for (const item of o.history) {
        if (!item || typeof item !== 'object') continue
        const h = item as Record<string, unknown>
        if (typeof h.url !== 'string' || !h.url) continue
        historyIn.push({
          id: typeof h.id === 'string' ? h.id : crypto.randomUUID(),
          title: typeof h.title === 'string' && h.title.trim() ? h.title : h.url,
          url: h.url,
          visitedAt: typeof h.visitedAt === 'number' ? h.visitedAt : Date.now(),
        })
      }
    }
    return {
      tabs: tabsIn,
      activeId: active,
      bookmarks: bookmarksIn,
      history: historyIn.slice(0, 200),
    }
  }

  function saveWorkspace(): void {
    if (!currentProjectId || loadingWorkspace) return
    const snap = serializeWorkspace()
    workspaces.set(currentProjectId, snap)
    const root = currentProjectPath
    if (!root) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void window.enpiistudio?.browser?.workspace?.save?.(root, snap)
    }, 250)
  }

  async function loadWorkspaceFromDisk(projectId: string, projectPath: string): Promise<BrowserWorkspace> {
    const cached = workspaces.get(projectId)
    if (cached) return cached
    try {
      const raw = await window.enpiistudio?.browser?.workspace?.load?.(projectPath)
      const parsed = parseWorkspace(raw)
      if (parsed) {
        workspaces.set(projectId, parsed)
        return parsed
      }
    } catch {
      /* fall through */
    }
    return workspaceFor(projectId)
  }

  function normalizeUrl(value: string): string {
    const raw = value.trim()
    if (!raw) return ''
    const candidate = suggestNavigateUrl(raw)
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(t('browser.httpOnly'))
    return url.toString()
  }

  function registerWebview(id: string, element: BrowserElement | undefined): void {
    if (!element) return
    webviews.set(id, element)
    if (cleanups.has(id)) return
    const tab = tabs.find((item) => item.id === id)
    if (!tab) return

    const sync = (event: Event) => {
      const source = event.target as BrowserElement
      const url = source.getURL?.() ?? tab.url
      if (url && url !== 'about:blank') tab.url = url
      if (id === activeId) address = tab.url
      if (url && url !== 'about:blank') recordHistory(url, tab.title)
      syncNav(tab, source)
      pushPanel()
    }
    const start = () => (tab.loading = true)
    const stop = () => {
      tab.loading = false
      syncNav(tab, element)
      if (pageTheme === 'dark') void applyTheme(id)
      }
    const ready = () => {
      tab.ready = true
      syncNav(tab, element)
      // Load pending URL once if webview still blank. Do NOT reload on every dom-ready
      // (that aborts in-flight navigations → ERR_FAILED / GUEST_VIEW_MANAGER_CALL).
      try {
        const cur = element.getURL?.() ?? ''
        if (tab.url && (!cur || cur === 'about:blank')) {
          void element.loadURL(tab.url).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err)
            if (!/ERR_ABORTED|ERR_FAILED/i.test(msg)) error = msg
          })
        }
      } catch {
        /* ignore */
      }
      if (pageTheme === 'dark') void applyTheme(id)
    }
    const title = (event: Event) => {
      const pageTitle = (event as Event & { title?: string }).title?.trim()
      if (pageTitle) {
        tab.title = pageTitle
        history = history.map((entry, index) => index === 0 && entry.url === tab.url ? { ...entry, title: pageTitle } : entry)
        saveWorkspace()
      }
    }
    const found = (event: Event) => {
      const result = (event as Event & { result?: { activeMatchOrdinal: number; matches: number } }).result
      if (!result || id !== activeId) return
      findActive = result.activeMatchOrdinal
      findMatches = result.matches
    }
    element.addEventListener('did-navigate', sync)
    element.addEventListener('did-navigate-in-page', sync)
    element.addEventListener('did-start-loading', start)
    element.addEventListener('did-stop-loading', stop)
    element.addEventListener('dom-ready', ready)
    element.addEventListener('page-title-updated', title)
    element.addEventListener('found-in-page', found)
    cleanups.set(id, () => {
      element.removeEventListener('did-navigate', sync)
      element.removeEventListener('did-navigate-in-page', sync)
      element.removeEventListener('did-start-loading', start)
      element.removeEventListener('did-stop-loading', stop)
      element.removeEventListener('dom-ready', ready)
      element.removeEventListener('page-title-updated', title)
      element.removeEventListener('found-in-page', found)
    })
  }

  async function applyTheme(id: string): Promise<void> {
    const element = webviews.get(id)
    const tab = tabs.find((item) => item.id === id)
    if (!element || !tab || !tab.ready) return
    const previous = themeKeys.get(id)
    if (previous) await element.removeInsertedCSS(previous).catch(() => {})
    themeKeys.delete(id)
    return
    /*
    if (pageTheme === 'light') return
    // Soft dark: color-scheme only — avoid !important paint on inputs (breaks login UIs).
    const key = await element.insertCSS(`
      :root { color-scheme: ${pageTheme}; }
      html { background: ${color.browserBg}; }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: rgba(255,255,255,0.045); }
      ::-webkit-scrollbar-thumb { background: rgba(170,170,190,0.42); border: 2px solid transparent; border-radius: 999px; background-clip: padding-box; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(190,190,210,0.62); border: 2px solid transparent; background-clip: padding-box; }
    `)
    themeKeys.set(id, key)
    */
  }

  async function navigate(value = address): Promise<void> {
    const tab = activeTab
    if (!tab) return
    error = ''
    try {
      const url = normalizeUrl(value)
      tab.url = url
      tab.title = url ? new URL(url).hostname : 'New Tab'
      address = url
      pushPanel()
      if (!url) return
      // Queue until webview ready — ready handler loads about:blank → url once.
      if (!tab.ready) return
      tab.loading = true
      try {
        await webviews.get(tab.id)?.loadURL(url)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Aborted loads are normal when user navigates again quickly.
        if (!/ERR_ABORTED|-3/i.test(msg)) error = msg
      } finally {
        tab.loading = false
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function activateTab(id: string): void {
    activeId = id
    address = tabs.find((tab) => tab.id === id)?.url ?? ''
    void tick().then(() => input?.focus())
  }

  function addTab(): void {
    const tab = newTab()
    tabs = [...tabs, tab]
    activeId = tab.id
    address = ''
  }

  function closeTab(id: string): void {
    if (tabs.length === 1) {
      const tab = tabs[0]!
      tab.url = ''
      tab.title = 'New Tab'
      tab.loading = false
      tab.canBack = false
      tab.canForward = false
      address = ''
      return
    }
    const index = tabs.findIndex((tab) => tab.id === id)
    cleanups.get(id)?.()
    cleanups.delete(id)
    webviews.delete(id)
    themeKeys.delete(id)
    tabs = tabs.filter((tab) => tab.id !== id)
    if (id === activeId) activateTab(tabs[Math.max(0, index - 1)]!.id)
  }

  function closeActiveTab(): void {
    if (activeId) closeTab(activeId)
  }

  function cycleTab(direction: 1 | -1): void {
    if (tabs.length < 2) return
    const index = tabs.findIndex((tab) => tab.id === activeId)
    const next = (index + direction + tabs.length) % tabs.length
    activateTab(tabs[next]!.id)
  }

  function goBack(): void {
    const tab = activeTab
    if (!tab?.canBack) return
    safeCall(webviews.get(tab.id), (v) => v.goBack())
  }

  function goForward(): void {
    const tab = activeTab
    if (!tab?.canForward) return
    safeCall(webviews.get(tab.id), (v) => v.goForward())
  }

  function reload(): void {
    safeCall(activeTab ? webviews.get(activeTab.id) : undefined, (v) => v.reload())
  }

  async function focusAddress(): Promise<void> {
    await tick()
    input?.focus()
    input?.select()
  }

  async function openFind(): Promise<void> {
    findOpen = true
    await tick()
    findInput?.focus()
    findInput?.select()
    if (findQuery) safeCall(findActiveTab(), (v) => v.findInPage(findQuery))
  }

  function findActiveTab(): BrowserElement | undefined {
    return activeTab ? webviews.get(activeTab.id) : undefined
  }

  function searchPage(findNext = false, forward = true): void {
    const view = findActiveTab()
    if (!findQuery) {
      findMatches = 0
      findActive = 0
      safeCall(view, (v) => v.stopFindInPage('clearSelection'))
      return
    }
    safeCall(view, (v) => {
      v.findInPage(findQuery, { forward, findNext })
    })
  }

  function closeFind(): void {
    safeCall(findActiveTab(), (v) => v.stopFindInPage('clearSelection'))
    findOpen = false
    findQuery = ''
    findMatches = 0
    findActive = 0
  }

  function toggleBookmark(): void {
    const tab = activeTab
    if (!tab?.url) return
    const existing = bookmarks.find((bookmark) => bookmark.url === tab.url)
    if (existing) bookmarks = bookmarks.filter((bookmark) => bookmark.id !== existing.id)
    else bookmarks = [{ id: crypto.randomUUID(), title: tab.title || new URL(tab.url).hostname, url: tab.url }, ...bookmarks]
    saveWorkspace()
  }

  async function openBookmark(bookmark: BrowserBookmark): Promise<void> {
    bookmarksOpen = false
    address = bookmark.url
    await navigate(bookmark.url)
  }

  function startBookmarkRename(bookmark: BrowserBookmark): void {
    editingBookmarkId = bookmark.id
    editingBookmarkTitle = bookmark.title
    void tick().then(() => {
      bookmarkRenameInput?.focus()
      bookmarkRenameInput?.select()
    })
  }

  function finishBookmarkRename(save: boolean): void {
    const title = editingBookmarkTitle.trim()
    if (save && editingBookmarkId && title) {
      bookmarks = bookmarks.map((bookmark) => bookmark.id === editingBookmarkId ? { ...bookmark, title } : bookmark)
      saveWorkspace()
    }
    editingBookmarkId = null
    editingBookmarkTitle = ''
  }

  function removeBookmark(id: string): void {
    bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id)
    saveWorkspace()
  }

  function recordHistory(url: string, title: string): void {
    const normalizedTitle = title && title !== 'New Tab' ? title : new URL(url).hostname
    const latest = history[0]
    if (latest?.url === url) history = [{ ...latest, title: normalizedTitle, visitedAt: Date.now() }, ...history.slice(1)]
    else history = [{ id: crypto.randomUUID(), title: normalizedTitle, url, visitedAt: Date.now() }, ...history].slice(0, 200)
    saveWorkspace()
  }

  async function openHistoryEntry(entry: BrowserHistoryEntry): Promise<void> {
    historyOpen = false
    address = entry.url
    await navigate(entry.url)
  }

  function requestClearHistory(): void {
    clearHistoryOpen = true
  }

  function clearHistory(): void {
    history = []
    historyQuery = ''
    clearHistoryOpen = false
    saveWorkspace()
    app.notify('success', 'Browser history cleared')
  }

  function historyTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function updateDownload(download: BrowserDownload): void {
    const previous = downloads.find((item) => item.id === download.id)
    downloads = [download, ...downloads.filter((item) => item.id !== download.id)].sort((a, b) => b.startedAt - a.startedAt)
    if (previous?.status === download.status) return
    if (download.status === 'completed') app.notify('success', 'Download completed', download.filename)
    else if (download.status === 'interrupted') app.notify('error', 'Download interrupted', download.filename)
  }

  function downloadSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  }

  function downloadProgress(download: BrowserDownload): number {
    return download.totalBytes > 0 ? Math.min(100, download.receivedBytes / download.totalBytes * 100) : 0
  }

  async function openDownload(download: BrowserDownload): Promise<void> {
    const result = await window.enpiistudio.browser.downloads.open(download.id)
    if (result) app.notify('error', 'Could not open download', result)
  }

  async function revealDownload(download: BrowserDownload): Promise<void> {
    if (!await window.enpiistudio.browser.downloads.reveal(download.id)) app.notify('error', 'Download file unavailable', download.filename)
  }

  $effect(() => {
    void pageTheme
    for (const tab of tabs) {
      if (tab.ready) void applyTheme(tab.id)
    }
  })

  $effect(() => {
    const projectId = app.activeProjectId
    const projectPath = app.activeProject?.path ?? null
    if (!projectId || !projectPath) return
    if (currentProjectId === projectId && currentProjectPath === projectPath) return
    const prevId = currentProjectId
    const prevPath = currentProjectPath
    if (prevId && prevPath && prevId !== projectId) {
      // flush previous project immediately
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      const snap = workspaces.get(prevId)
      if (snap) void window.enpiistudio?.browser?.workspace?.save?.(prevPath, snap)
    }
    resetWebviews()
    currentProjectId = projectId
    currentProjectPath = projectPath
    loadingWorkspace = true
    void loadWorkspaceFromDisk(projectId, projectPath).then((workspace) => {
      if (currentProjectId !== projectId) return
      tabs = workspace.tabs.map((t) => ({
        ...t,
        ready: false,
        loading: false,
        canBack: false,
        canForward: false,
      }))
      activeId = workspace.activeId
      bookmarks = workspace.bookmarks
      history = workspace.history
      bookmarksOpen = false
      historyOpen = false
      downloadsOpen = false
      address = tabs.find((tab) => tab.id === activeId)?.url ?? ''
      loadingWorkspace = false
    })
  })

  $effect(() => {
    const count = tabs.length + webviewElements.length
    void count
    void tick().then(() => {
      tabs.forEach((tab, index) => registerWebview(tab.id, webviewElements[index]))
    })
  })

  function onRailNavigate(ev: Event): void {
    const url = (ev as CustomEvent<{ url?: string }>).detail?.url
    if (!url) return
    address = url
    void navigate(url)
  }

  async function scrapeOutline(): Promise<void> {
    const tab = activeTab
    const view = tab ? webviews.get(tab.id) : undefined
    const origin = classifyBrowserUrl(tab?.url, { projectRoot: app.activeProject?.path })
    if (!tab || !view || origin !== 'project') {
      syncBrowserPanel({ outline: [], outlineError: origin === 'project' ? 'Webview not ready' : 'Outline only on project pages', outlineBusy: false })
      return
    }
    syncBrowserPanel({ outlineBusy: true, outlineError: '' })
    try {
      const raw = await view.executeJavaScript(OUTLINE_SCRAPE_JS, false)
      const nodes = Array.isArray(raw) ? (raw as OutlineNode[]) : []
      syncBrowserPanel({ outline: nodes, outlineBusy: false, outlineError: nodes.length ? '' : 'No elements found' })
    } catch (err) {
      syncBrowserPanel({
        outline: [],
        outlineBusy: false,
        outlineError: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function highlightOutline(path: string, node?: OutlineNode | null): Promise<void> {
    const tab = activeTab
    const view = tab ? webviews.get(tab.id) : undefined
    if (!view || !path) return
    const fromTree =
      node ?? browserPanel.outline.find((n) => n.path === path) ?? browserPanel.selectedNode
    const selected: OutlineNode =
      fromTree && fromTree.path === path
        ? fromTree
        : { id: 'sel', tag: path.split('/').pop()?.split(':')[0]?.toLowerCase() || 'div', label: path, depth: 0, path }
    syncBrowserPanel({ selectedPath: path, selectedNode: selected })
    try {
      await view.executeJavaScript(OUTLINE_HIGHLIGHT_JS(path), false)
    } catch {
      /* ignore */
    }
  }

  async function clearOutlineHighlight(): Promise<void> {
    const tab = activeTab
    const view = tab ? webviews.get(tab.id) : undefined
    await stopPickMode()
    syncBrowserPanel({ selectedPath: '', selectedNode: null })
    if (!view) return
    try {
      await view.executeJavaScript(OUTLINE_CLEAR_JS, false)
    } catch {
      /* ignore */
    }
  }

  let pickPollTimer: ReturnType<typeof setInterval> | null = null

  async function stopPickMode(): Promise<void> {
    if (pickPollTimer) {
      clearInterval(pickPollTimer)
      pickPollTimer = null
    }
    syncBrowserPanel({ pickMode: false })
    const tab = activeTab
    const view = tab ? webviews.get(tab.id) : undefined
    if (!view) return
    try {
      await view.executeJavaScript(OUTLINE_PICK_STOP_JS, false)
    } catch {
      /* ignore */
    }
  }

  async function startPickMode(): Promise<void> {
    const tab = activeTab
    const view = tab ? webviews.get(tab.id) : undefined
    const origin = classifyBrowserUrl(tab?.url, { projectRoot: app.activeProject?.path })
    if (!tab || !view || origin !== 'project') {
      app.notify('warning', 'Pick element', 'Only on Project pages')
      return
    }
    try {
      await view.executeJavaScript(OUTLINE_PICK_START_JS, false)
      syncBrowserPanel({ pickMode: true })
      if (pickPollTimer) clearInterval(pickPollTimer)
      pickPollTimer = setInterval(() => {
        void (async () => {
          try {
            const raw = await view.executeJavaScript(OUTLINE_PICK_POLL_JS, false)
            if (!raw || typeof raw !== 'object') return
            if ((raw as { stopped?: boolean }).stopped) {
              await stopPickMode()
              return
            }
            const n = raw as OutlineNode
            if (!n.path) return
            const node: OutlineNode = {
              id: n.id || `pick-${Date.now()}`,
              tag: n.tag || 'div',
              label: n.label || n.tag || n.path,
              depth: typeof n.depth === 'number' ? n.depth : 0,
              path: n.path,
            }
            const exists = browserPanel.outline.some((x) => x.path === node.path)
            syncBrowserPanel({
              selectedPath: node.path,
              selectedNode: node,
              outline: exists ? browserPanel.outline : [node, ...browserPanel.outline].slice(0, 200),
            })
          } catch {
            /* ignore poll errors */
          }
        })()
      }, 200)
    } catch (err) {
      syncBrowserPanel({ pickMode: false })
      app.notify('error', 'Pick failed', err instanceof Error ? err.message : String(err))
    }
  }

  async function togglePickMode(on?: boolean): Promise<void> {
    const want = on !== undefined ? on : !browserPanel.pickMode
    if (want) await startPickMode()
    else await stopPickMode()
  }

  function onOutlineAi(ev: Event): void {
    const d = (ev as CustomEvent<{
      path?: string
      tag?: string
      label?: string
      url?: string
      instruction?: string
    }>).detail
    if (!d?.path || !d.instruction?.trim()) return
    void stopPickMode()
    const label = (d.label || d.tag || 'element').replace(/\s+/g, ' ').slice(0, 80)
    const prompt = [
      `UI edit from Browser (user stays on the preview — do not chat).`,
      `Page: ${d.url ?? ''}`,
      `Target: ${label}`,
      `DOM path (match source only): ${d.path}`,
      `User wants: ${d.instruction.trim()}`,
      `Find the source component and apply a minimal edit_file change. No re-pick. Short summary only.`,
    ].join('\n')
    // Hidden session — not the open Agent transcript.
    setBrowserEditJob({ status: 'running', detail: 'Working…', startedAt: Date.now() })
    void runBrowserUiEdit(prompt, { model: app.provider?.model }).then(
      () => {
        setBrowserEditJob({ status: 'done', detail: 'Done — reload preview if needed' })
        // Soft refresh preview if still on same tab.
        try {
          const tab = activeTab
          const view = tab ? webviews.get(tab.id) : undefined
          view?.reload()
        } catch {
          /* ignore */
        }
        window.setTimeout(() => {
          setBrowserEditJob({ status: 'idle', detail: '' })
        }, 4000)
      },
      (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setBrowserEditJob({ status: 'error', detail: msg.slice(0, 120) })
        app.notify('error', 'UI edit failed', msg)
      },
    )
  }

  onMount(() => {
    void window.enpiistudio.browser.downloads.list().then((items) => (downloads = items.sort((a, b) => b.startedAt - a.startedAt)))
    const offDownloads = window.enpiistudio.browser.downloads.onChange(updateDownload)
    const offShortcut = window.enpiistudio.browser.onShortcut((shortcut) => {
      if (app.mode !== 'browser') return
      if (shortcut === 'close-tab') closeActiveTab()
      else if (shortcut === 'new-tab') addTab()
      else if (shortcut === 'next-tab') cycleTab(1)
      else if (shortcut === 'previous-tab') cycleTab(-1)
      else if (shortcut === 'focus-address') void focusAddress()
      else if (shortcut === 'find-page') void openFind()
      else if (shortcut === 'reload') reload()
      else if (shortcut === 'back') goBack()
      else if (shortcut === 'forward') goForward()
    })
    window.addEventListener('enpiistudio:browser-navigate', onRailNavigate)
    const onRefresh = () => void scrapeOutline()
    const onHl = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path
      if (path) void highlightOutline(path)
    }
    const onClear = () => void clearOutlineHighlight()
    const onPick = (e: Event) => {
      const on = (e as CustomEvent<{ on?: boolean }>).detail?.on
      void togglePickMode(on)
    }
    window.addEventListener('enpiistudio:browser-outline-refresh', onRefresh)
    window.addEventListener('enpiistudio:browser-outline-highlight', onHl)
    window.addEventListener('enpiistudio:browser-outline-clear', onClear)
    window.addEventListener('enpiistudio:browser-outline-ai', onOutlineAi)
    window.addEventListener('enpiistudio:browser-outline-pick', onPick)
    return () => {
      offShortcut()
      offDownloads()
      if (pickPollTimer) clearInterval(pickPollTimer)
      window.removeEventListener('enpiistudio:browser-navigate', onRailNavigate)
      window.removeEventListener('enpiistudio:browser-outline-refresh', onRefresh)
      window.removeEventListener('enpiistudio:browser-outline-highlight', onHl)
      window.removeEventListener('enpiistudio:browser-outline-clear', onClear)
      window.removeEventListener('enpiistudio:browser-outline-ai', onOutlineAi)
      window.removeEventListener('enpiistudio:browser-outline-pick', onPick)
    }
  })

  onDestroy(() => {
    if (pickPollTimer) clearInterval(pickPollTimer)
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    if (currentProjectId && currentProjectPath && !loadingWorkspace) {
      const snap = serializeWorkspace()
      workspaces.set(currentProjectId, snap)
      void window.enpiistudio?.browser?.workspace?.save?.(currentProjectPath, snap)
    }
    for (const cleanup of cleanups.values()) cleanup()
  })
</script>

<div class="relative flex h-full min-h-0 flex-col bg-transparent">
  <div class="flex h-9 items-center overflow-x-auto border-b border-border-subtle bg-studio-panel/95" role="tablist" aria-label="Open browser tabs">
    {#each tabs as tab (tab.id)}
      <div class="flex h-full items-center border-r border-border-subtle {tab.id === activeId ? 'border-b-2 border-b-studio-purple bg-studio-purple/20' : 'border-b-2 border-b-transparent'}">
        <button type="button" class="flex items-center gap-1.5 px-2 text-[11px] {tab.id === activeId ? 'text-studio-text' : 'text-studio-text-dim hover:text-studio-text'}" role="tab" aria-selected={tab.id === activeId} onclick={() => activateTab(tab.id)}>
          <span class="size-1.5 rounded-lg {tab.loading ? 'animate-pulse bg-studio-gold' : 'bg-studio-success'}"></span>
          <span class="max-w-[140px] truncate">{tab.title}</span>
        </button>
        <button type="button" class="mx-1 grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text" aria-label={`Close ${tab.title}`} onclick={() => closeTab(tab.id)}><Icon name="close" size={12} /></button>
      </div>
    {/each}
    <button type="button" class="ml-1.5 grid size-7 shrink-0 place-items-center rounded text-studio-text-dim hover:bg-white/10 hover:text-studio-text" aria-label="New browser tab" onclick={addTab}><Icon name="plus" size={14} /></button>
  </div>

  <div class="flex items-center gap-1 border-b border-border-subtle bg-studio-panel/80 px-2 py-1">
    <button type="button" class={toolBtn} title="Back" aria-label="Back" disabled={!activeTab?.canBack} onclick={goBack}><Icon name="arrow-left" size={14} /></button>
    <button type="button" class={toolBtn} title="Forward" aria-label="Forward" disabled={!activeTab?.canForward} onclick={goForward}><Icon name="arrow-right" size={14} /></button>
    <button type="button" class={toolBtn} title="Reload" aria-label="Reload" onclick={reload}><Icon name={loading ? 'close' : 'reload'} size={14} /></button>
    <form
      class="mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-border-subtle bg-studio-dark px-3 py-1 focus-within:border-studio-purple/45"
      onsubmit={(e) => {
        e.preventDefault()
        void navigate()
      }}
    >
      {#if originBadge}
        <span
          class="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide
            {pageOrigin === 'project'
            ? 'border-studio-success/40 bg-studio-success/15 text-studio-success'
            : pageOrigin === 'local'
              ? 'border-studio-gold/40 bg-studio-gold/10 text-studio-gold'
              : pageOrigin === 'public'
                ? 'border-white/12 bg-white/5 text-studio-text-dim'
                : 'border-border-subtle text-studio-text-dim'}"
          title={pageOrigin}
        >{originBadge}</span>
      {/if}
      <input
        class="min-w-0 flex-1 bg-transparent text-[12px] text-studio-text outline-none placeholder:text-studio-text-dim"
        bind:this={input}
        bind:value={address}
        aria-label="Address"
        placeholder="Search or enter URL"
        autocomplete="off"
        spellcheck={false}
      />
    </form>
    <button type="button" class="{toolBtn} {activeBookmark ? toolBtnActive : ''}" title={activeBookmark ? 'Remove bookmark' : 'Bookmark'} aria-label={activeBookmark ? 'Remove bookmark' : 'Bookmark'} disabled={!activeTab?.url} onclick={toggleBookmark}><Icon name={activeBookmark ? 'star-fill' : 'star-outline'} size={14} /></button>
    <Dropdown
      items={[
        { id: 'bookmarks', label: 'Bookmarks' },
        { id: 'history', label: 'History' },
        {
          id: 'downloads',
          label: activeDownloads ? `Downloads (${activeDownloads})` : 'Downloads',
        },
        { id: 'find', label: 'Find in page' },
        { id: 'devtools', label: 'DevTools', disabled: !activeTab },
      ]}
      label="More"
      align="end"
      onSelect={(id) => {
        if (id === 'bookmarks') {
          historyOpen = false
          downloadsOpen = false
          bookmarksOpen = !bookmarksOpen
        } else if (id === 'history') {
          bookmarksOpen = false
          downloadsOpen = false
          historyOpen = !historyOpen
        } else if (id === 'downloads') {
          bookmarksOpen = false
          historyOpen = false
          downloadsOpen = !downloadsOpen
        } else if (id === 'find') void openFind()
        else if (id === 'devtools') {
          const wv = activeTab ? webviews.get(activeTab.id) : undefined
          try {
            wv?.openDevTools?.()
          } catch (err) {
            error = err instanceof Error ? err.message : String(err)
          }
        }
      }}
    >
      {#snippet trigger({ open, toggle })}
        <button
          type="button"
          class="{toolBtn} {open || bookmarksOpen || historyOpen || downloadsOpen ? toolBtnActive : ''}"
          title="More"
          aria-label="More browser actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onclick={(e) => {
            e.stopPropagation()
            toggle()
          }}
        ><Icon name="more-vertical" size={14} /></button>
      {/snippet}
    </Dropdown>
  </div>

  {#if findOpen}
    <button type="button" class="fixed inset-0 z-[60] cursor-default bg-transparent" aria-label="Close find" onclick={closeFind}></button>
    <section
      class="absolute right-3 top-[76px] z-[61] flex w-72 items-center gap-1 rounded-lg border border-border-subtle bg-studio-popover p-1.5 shadow-lg"
      aria-label="Find in page"
      role="search"
    >
      <input
        class="min-w-0 flex-1 rounded-md border border-border-subtle bg-studio-dark px-2 py-1.5 text-xs text-studio-text outline-none focus:border-studio-purple/45"
        bind:this={findInput}
        bind:value={findQuery}
        aria-label="Find in page"
        placeholder="Find in page"
        oninput={() => searchPage(false)}
        onkeydown={(event) => {
          if (event.key === 'Escape') closeFind()
          else if (event.key === 'Enter') {
            event.preventDefault()
            searchPage(true, !event.shiftKey)
          }
        }}
      />
      <span class="w-10 shrink-0 text-center text-[10px] tabular-nums text-studio-text-dim">{findMatches ? `${findActive}/${findMatches}` : '0/0'}</span>
      <button type="button" class="grid size-7 shrink-0 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text" title="Previous" aria-label="Previous match" onclick={() => searchPage(true, false)}><Icon name="chevron-up" size={14} /></button>
      <button type="button" class="grid size-7 shrink-0 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text" title="Next" aria-label="Next match" onclick={() => searchPage(true, true)}><Icon name="chevron-down" size={14} /></button>
      <button type="button" class="grid size-7 shrink-0 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text" aria-label="Close find" onclick={closeFind}><Icon name="close" size={12} /></button>
    </section>
  {/if}

  {#if bookmarksOpen}
    <button type="button" class="fixed inset-0 z-[60] cursor-default bg-black/20" aria-label="Close bookmarks" onclick={() => (bookmarksOpen = false)}></button>
    <section class="absolute right-3 top-[76px] z-[61] flex max-h-[min(420px,60vh)] w-80 flex-col overflow-hidden rounded-lg border border-border-subtle bg-studio-popover" aria-label="Bookmarks">
      <header class="flex items-center justify-between border-b border-border-subtle px-3 py-2 text-[11px]"><strong class="text-studio-text">Bookmarks</strong><span class="text-studio-text-dim">{bookmarks.length}</span></header>
      <div class="min-h-0 flex-1 overflow-auto p-1.5">
        {#each bookmarks as bookmark (bookmark.id)}
          <div class="mb-0.5 flex items-start gap-1 rounded-md p-1 hover:bg-white/[0.04]">
            {#if editingBookmarkId === bookmark.id}
              <input class="w-full rounded-md border border-white/9 bg-black/25 px-2 py-1 text-xs text-studio-text outline-none" bind:this={bookmarkRenameInput} bind:value={editingBookmarkTitle} aria-label="Bookmark name" onblur={() => finishBookmarkRename(true)} onkeydown={(event) => { if (event.key === 'Enter') finishBookmarkRename(true); else if (event.key === 'Escape') finishBookmarkRename(false) }} />
            {:else}
              <button type="button" class="min-w-0 flex-1 truncate text-left" onclick={() => void openBookmark(bookmark)} ondblclick={() => startBookmarkRename(bookmark)}>
                <strong class="block truncate text-xs text-studio-text">{bookmark.title}</strong>
                <span class="block truncate text-[10px] text-studio-text-dim">{bookmark.url}</span>
              </button>
              <button type="button" class="shrink-0 px-1 text-[10px] text-studio-text-dim hover:text-studio-text" aria-label={`Rename ${bookmark.title}`} onclick={() => startBookmarkRename(bookmark)}>Rename</button>
              <button type="button" class="grid size-6 shrink-0 place-items-center text-danger" aria-label={`Remove ${bookmark.title}`} onclick={() => removeBookmark(bookmark.id)}><Icon name="close" size={11} /></button>
            {/if}
          </div>
        {:else}
          <div class="px-2 py-6 text-center text-[11px] text-studio-text-dim">No bookmarks yet.</div>
        {/each}
      </div>
    </section>
  {/if}

  {#if downloadsOpen}
    <button type="button" class="fixed inset-0 z-[60] cursor-default bg-black/20" aria-label="Close downloads" onclick={() => (downloadsOpen = false)}></button>
    <section class="absolute right-3 top-[76px] z-[61] flex max-h-[min(420px,60vh)] w-96 flex-col overflow-hidden rounded-lg border border-border-subtle bg-studio-popover" aria-label="Downloads">
      <header class="flex items-center justify-between border-b border-border-subtle px-3 py-2 text-[11px]"><strong class="text-studio-text">Downloads</strong><span class="text-studio-text-dim">{downloads.length}</span></header>
      <div class="min-h-0 flex-1 overflow-auto p-1.5">
        {#each downloads as download (download.id)}
          <div class="mb-1 rounded-md border border-border-subtle bg-studio-card p-2">
            <div class="flex items-start gap-1">
              <div class="min-w-0 flex-1">
                <strong class="block truncate text-xs text-studio-text">{download.filename}</strong>
                <span class="text-[10px] text-studio-text-dim">{download.status === 'progressing' ? `${downloadSize(download.receivedBytes)} / ${download.totalBytes ? downloadSize(download.totalBytes) : '—'}` : download.status}</span>
              </div>
              {#if download.status === 'progressing'}
                <button type="button" class={toolBtn} onclick={() => void window.enpiistudio.browser.downloads.cancel(download.id)}>Cancel</button>
              {:else if download.status === 'completed'}
                <button type="button" class={toolBtn} onclick={() => void openDownload(download)}>Open</button>
                <button type="button" class={toolBtn} onclick={() => void revealDownload(download)}>Folder</button>
              {/if}
            </div>
            <div class="mt-1.5 h-1 overflow-hidden rounded-lg bg-white/5">
              <span class="block h-full rounded-lg bg-studio-purple" style={`width:${downloadProgress(download)}%`}></span>
            </div>
          </div>
        {:else}
          <div class="px-2 py-6 text-center text-[11px] text-studio-text-dim">No downloads yet.</div>
        {/each}
      </div>
    </section>
  {/if}

  {#if historyOpen}
    <button type="button" class="fixed inset-0 z-[60] cursor-default bg-black/20" aria-label="Close history" onclick={() => (historyOpen = false)}></button>
    <section class="absolute right-3 top-[76px] z-[61] flex max-h-[min(480px,70vh)] w-96 flex-col overflow-hidden rounded-lg border border-border-subtle bg-studio-popover" aria-label="Browser history">
      <header class="flex items-center justify-between border-b border-border-subtle px-3 py-2 text-[11px]">
        <strong class="text-studio-text">History</strong>
        <button type="button" class={toolBtn} disabled={!history.length} onclick={requestClearHistory}>Clear</button>
      </header>
      <div class="border-b border-border-subtle p-2">
        <TextInput bind:value={historyQuery} placeholder="Search history" aria-label="Search history" />
      </div>
      <div class="min-h-0 flex-1 overflow-auto p-1.5">
        {#each filteredHistory as entry (entry.id)}
          <button type="button" class="mb-0.5 flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.04]" onclick={() => void openHistoryEntry(entry)}>
            <div class="min-w-0">
              <strong class="block truncate text-xs text-studio-text">{entry.title}</strong>
              <span class="block truncate text-[10px] text-studio-text-dim">{entry.url}</span>
            </div>
            <time class="shrink-0 text-[10px] text-studio-text-dim">{historyTime(entry.visitedAt)}</time>
          </button>
        {:else}
          <div class="px-2 py-6 text-center text-[11px] text-studio-text-dim">{history.length ? 'No matching history.' : 'No history yet.'}</div>
        {/each}
      </div>
    </section>
  {/if}

  {#if error}<div class="px-3 py-1.5 font-mono text-[11px] text-danger">{error}</div>{/if}

  <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-studio-dark">
    {#key browserPartition}
      {#each tabs as tab, index (tab.id)}
        <webview
          bind:this={webviewElements[index]}
          class="absolute inset-0 h-full w-full {tab.id !== activeId ? 'invisible pointer-events-none' : ''}"
          src="about:blank"
          partition={browserPartition}
          allowpopups
        ></webview>
      {/each}
    {/key}
    {#if !activeTab?.url && !loading}
      <div class="absolute inset-0 grid place-items-center text-center text-studio-text-dim">
        <div>
          <strong class="mb-1 block text-sm text-studio-text">Browser</strong>
          <span class="text-xs">Masukkan URL untuk mulai.</span>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* electron webview is replaced element — force fill */
  :global(webview) {
    display: flex;
  }
</style>

<ConfirmDialog
  open={clearHistoryOpen}
  title={t('browser.clearHistoryTitle')}
  message={t('browser.clearHistoryMsg')}
  cancelLabel={t('browser.cancel')}
  confirmLabel={t('browser.clearHistoryConfirm')}
  danger
  onCancel={() => (clearHistoryOpen = false)}
  onConfirm={clearHistory}
/>
