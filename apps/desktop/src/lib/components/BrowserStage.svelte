<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { state as app } from '../store.svelte'
  import { color } from '../theme'
  import type { BrowserDownload } from '../../../electron/preload'
  import { ConfirmDialog } from './ui'

  type BrowserElement = HTMLElement & {
    canGoBack: () => boolean
    canGoForward: () => boolean
    goBack: () => void
    goForward: () => void
    reload: () => void
    loadURL: (url: string) => Promise<void>
    insertCSS: (css: string) => Promise<string>
    removeInsertedCSS: (key: string) => Promise<void>
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
  let theme = $state<'dark' | 'light'>('dark')
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
  let webviewElements = $state<(BrowserElement | undefined)[]>([])
  let webviews = new Map<string, BrowserElement>()
  let themeKeys = new Map<string, string>()
  let cleanups = new Map<string, () => void>()
  const workspaces = new Map<string, BrowserWorkspace>()

  /** Per-project cookie/storage isolation for webviews. */
  const browserPartition = $derived(
    app.activeProjectId ? `persist:enpii-browser-${app.activeProjectId}` : 'persist:enpii-browser',
  )
  const activeTab = $derived(tabs.find((tab) => tab.id === activeId) ?? null)
  const loading = $derived(activeTab?.loading ?? false)
  const activeBookmark = $derived(bookmarks.find((bookmark) => bookmark.url === activeTab?.url) ?? null)
  const filteredHistory = $derived(history.filter((entry) => `${entry.title} ${entry.url}`.toLowerCase().includes(historyQuery.trim().toLowerCase())))
  const activeDownloads = $derived(downloads.filter((download) => download.status === 'progressing').length)

  const toolBtn =
    'rounded-md border border-border-subtle px-2 py-1 text-[11px] text-studio-text-dim hover:bg-white/5 hover:text-studio-text disabled:opacity-45'
  const toolBtnActive = 'border-studio-purple/40 bg-studio-purple/15 text-studio-text'

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

  function saveWorkspace(): void {
    if (!currentProjectId) return
    workspaces.set(currentProjectId, { tabs, activeId, bookmarks, history })
  }

  function normalizeUrl(value: string): string {
    const raw = value.trim()
    if (!raw) return ''
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Browser hanya mendukung URL http/https')
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
    }
    const start = () => (tab.loading = true)
    const stop = () => {
      tab.loading = false
      syncNav(tab, element)
      void applyTheme(id)
    }
    const ready = () => {
      tab.ready = true
      syncNav(tab, element)
      if (tab.url) void element.loadURL(tab.url).catch(() => {})
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
    if (theme === 'light') return
    const key = await element.insertCSS(`
      :root { color-scheme: dark !important; }
      html, body { background: ${color.browserBg} !important; color: ${color.browserText} !important; }
      body > * { color-scheme: dark !important; }
      input, textarea, select, [contenteditable="true"] {
        background-color: ${color.browserSurface} !important; color: ${color.browserText} !important; border-color: ${color.browserBorder} !important;
      }
      a { color: ${color.link} !important; }
    `)
    themeKeys.set(id, key)
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
      if (url && tab.ready) {
        tab.loading = true
        await webviews.get(tab.id)?.loadURL(url)
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

  async function toggleTheme(): Promise<void> {
    theme = theme === 'dark' ? 'light' : 'dark'
    await Promise.all(tabs.map((tab) => applyTheme(tab.id)))
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

  function searchPage(): void {
    const view = findActiveTab()
    findMatches = 0
    findActive = 0
    if (!findQuery) {
      safeCall(view, (v) => v.stopFindInPage('clearSelection'))
      return
    }
    safeCall(view, (v) => {
      v.findInPage(findQuery)
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
    const projectId = app.activeProjectId
    if (!projectId || currentProjectId === projectId) return
    saveWorkspace()
    resetWebviews()
    currentProjectId = projectId
    const workspace = workspaceFor(projectId)
    // heal tabs from older workspaces missing nav flags
    tabs = workspace.tabs.map((t) => ({
      ...t,
      ready: false,
      loading: false,
      canBack: t.canBack ?? false,
      canForward: t.canForward ?? false,
    }))
    activeId = workspace.activeId
    bookmarks = workspace.bookmarks
    history = workspace.history
    bookmarksOpen = false
    historyOpen = false
    downloadsOpen = false
    address = tabs.find((tab) => tab.id === activeId)?.url ?? ''
  })

  $effect(() => {
    const count = tabs.length + webviewElements.length
    void count
    void tick().then(() => {
      tabs.forEach((tab, index) => registerWebview(tab.id, webviewElements[index]))
    })
  })

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
    return () => {
      offShortcut()
      offDownloads()
    }
  })

  onDestroy(() => {
    saveWorkspace()
    for (const cleanup of cleanups.values()) cleanup()
  })
</script>

<div class="relative flex h-full min-h-0 flex-col bg-transparent">
  <div class="flex min-h-9 items-stretch overflow-x-auto border-b border-border-subtle bg-studio-panel/95" role="tablist" aria-label="Open browser tabs">
    {#each tabs as tab (tab.id)}
      <div class="flex items-center border-r border-white/5 {tab.id === activeId ? 'bg-studio-purple/25 shadow-[inset_0_-2px_0_var(--color-studio-purple-active)]' : ''}">
        <button type="button" class="flex items-center gap-1.5 px-2 py-2 text-[11px] {tab.id === activeId ? 'text-studio-text' : 'text-studio-text-dim hover:text-studio-text'}" role="tab" aria-selected={tab.id === activeId} onclick={() => activateTab(tab.id)}>
          <span class="size-1.5 rounded-lg {tab.loading ? 'animate-pulse bg-studio-gold' : 'bg-studio-success'}"></span>
          <span class="max-w-[140px] truncate">{tab.title}</span>
        </button>
        <button type="button" class="mx-1 rounded px-1 py-1 text-[10px] text-studio-text-dim hover:bg-white/10 hover:text-studio-text" aria-label={`Close ${tab.title}`} onclick={() => closeTab(tab.id)}>×</button>
      </div>
    {/each}
    <button type="button" class="ml-1.5 rounded px-1.5 py-1 text-base text-studio-text-dim hover:bg-white/10 hover:text-studio-text" aria-label="New browser tab" onclick={addTab}>+</button>
  </div>

  <div class="flex flex-wrap items-center gap-1.5 border-b border-border-subtle bg-studio-card/90 px-2 py-1.5">
    <div class="flex items-center gap-0.5">
      <button type="button" class="{toolBtn} min-w-7" title="Back" aria-label="Back" disabled={!activeTab?.canBack} onclick={goBack}>‹</button>
      <button type="button" class="{toolBtn} min-w-7" title="Forward" aria-label="Forward" disabled={!activeTab?.canForward} onclick={goForward}>›</button>
      <button type="button" class="{toolBtn} min-w-7" title="Reload" aria-label="Reload" onclick={reload}>{loading ? '×' : '↻'}</button>
    </div>
    <div class="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-border-subtle bg-studio-dark px-2.5 py-1">
      <span class="text-[10px] text-studio-text-dim">⌁</span>
      <input class="min-w-0 flex-1 bg-transparent text-xs text-studio-text outline-none placeholder:text-studio-text-dim" bind:this={input} bind:value={address} aria-label="Address" placeholder="Enter URL" onkeydown={(event) => event.key === 'Enter' && void navigate()} />
      <button type="button" class="rounded-lg bg-studio-purple px-2.5 py-0.5 text-[10px] text-white" onclick={() => void navigate()}>Go</button>
    </div>
    <button type="button" class={toolBtn} title="Focus address" aria-label="Focus address" onclick={() => void focusAddress()}>⌘L</button>
    <button type="button" class={toolBtn} title="Find in page" aria-label="Find in page" onclick={() => void openFind()}>⌘F</button>
    <button type="button" class="{toolBtn} {activeBookmark ? toolBtnActive : ''}" title={activeBookmark ? 'Remove bookmark' : 'Bookmark page'} aria-label={activeBookmark ? 'Remove bookmark' : 'Bookmark page'} disabled={!activeTab?.url} onclick={toggleBookmark}>{activeBookmark ? '★' : '☆'}</button>
    <button type="button" class="{toolBtn} {bookmarksOpen ? toolBtnActive : ''}" title="Bookmarks" aria-label="Bookmarks" onclick={() => { historyOpen = false; downloadsOpen = false; bookmarksOpen = !bookmarksOpen }}>Bookmarks</button>
    <button type="button" class="{toolBtn} {historyOpen ? toolBtnActive : ''}" title="History" aria-label="History" onclick={() => { bookmarksOpen = false; downloadsOpen = false; historyOpen = !historyOpen }}>History</button>
    <button type="button" class="{toolBtn} {downloadsOpen ? toolBtnActive : ''}" title="Downloads" aria-label="Downloads" onclick={() => { bookmarksOpen = false; historyOpen = false; downloadsOpen = !downloadsOpen }}>
      Downloads{#if activeDownloads}<span class="ml-1 rounded-lg bg-studio-gold/20 px-1.5 text-[9px] text-studio-gold">{activeDownloads}</span>{/if}
    </button>
    <button type="button" class={toolBtn} title="Toggle browser theme" aria-label="Toggle browser theme" onclick={() => void toggleTheme()}>{theme === 'dark' ? '☼' : '☾'}</button>
    <button
      type="button"
      class={toolBtn}
      title="Open page DevTools"
      aria-label="Open page DevTools"
      disabled={!activeTab}
      onclick={() => {
        const wv = activeTab ? webviews.get(activeTab.id) : undefined
        try {
          wv?.openDevTools?.()
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
      }}
    >DevTools</button>
    {#if findOpen}
      <div class="flex items-center gap-1 rounded-md border border-border-subtle bg-studio-dark px-1.5 py-0.5">
        <input class="w-28 bg-transparent px-1 text-xs text-studio-text outline-none" bind:this={findInput} bind:value={findQuery} aria-label="Find in page" placeholder="Find" oninput={searchPage} onkeydown={(event) => event.key === 'Escape' && closeFind()} />
        <span class="text-[10px] text-studio-text-dim">{findMatches ? `${findActive}/${findMatches}` : '—'}</span>
        <button type="button" class="px-1 text-studio-text-dim hover:text-studio-text" aria-label="Close find" onclick={closeFind}>×</button>
      </div>
    {/if}
  </div>

  {#if bookmarksOpen}
    <button type="button" class="fixed inset-0 z-[60] cursor-default bg-black/20" aria-label="Close bookmarks" onclick={() => (bookmarksOpen = false)}></button>
    <section class="absolute right-3 top-[76px] z-[61] flex max-h-[min(420px,60vh)] w-80 flex-col overflow-hidden rounded-lg border border-white/11 bg-studio-popover shadow-[0_18px_50px_rgba(0,0,0,0.5)]" aria-label="Bookmarks">
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
              <button type="button" class="shrink-0 px-1 text-[11px] text-danger" aria-label={`Remove ${bookmark.title}`} onclick={() => removeBookmark(bookmark.id)}>×</button>
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
    <section class="absolute right-3 top-[76px] z-[61] flex max-h-[min(420px,60vh)] w-96 flex-col overflow-hidden rounded-lg border border-white/11 bg-studio-popover shadow-[0_18px_50px_rgba(0,0,0,0.5)]" aria-label="Downloads">
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
    <section class="absolute right-3 top-[76px] z-[61] flex max-h-[min(480px,70vh)] w-96 flex-col overflow-hidden rounded-lg border border-white/11 bg-studio-popover shadow-[0_18px_50px_rgba(0,0,0,0.5)]" aria-label="Browser history">
      <header class="flex items-center justify-between border-b border-border-subtle px-3 py-2 text-[11px]">
        <strong class="text-studio-text">History</strong>
        <button type="button" class={toolBtn} disabled={!history.length} onclick={requestClearHistory}>Clear</button>
      </header>
      <div class="border-b border-border-subtle p-2">
        <input class="w-full rounded-md border border-white/9 bg-black/25 px-2.5 py-1.5 text-xs text-studio-text outline-none focus:border-studio-purple-bright/80" bind:value={historyQuery} placeholder="Search history" aria-label="Search history" />
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

  <div class="relative min-h-0 flex-1 overflow-hidden bg-studio-dark">
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
  title="Clear browser history?"
  message="Semua riwayat browser project ini akan dihapus."
  cancelLabel="Batal"
  confirmLabel="Clear"
  danger
  onCancel={() => (clearHistoryOpen = false)}
  onConfirm={clearHistory}
/>
