<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { state as app } from '../store.svelte'
  import type { BrowserDownload } from '../../../electron/preload'

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
  let cancelClearHistoryButton = $state<HTMLButtonElement>()
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

  function newTab(): BrowserTab {
    return { id: crypto.randomUUID(), title: 'New Tab', url: '', ready: false, loading: false }
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
    }
    const start = () => (tab.loading = true)
    const stop = () => {
      tab.loading = false
      void applyTheme(id)
    }
    const ready = () => {
      tab.ready = true
      if (tab.url) void element.loadURL(tab.url)
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
      html, body { background: #0f1115 !important; color: #e8eaed !important; }
      body > * { color-scheme: dark !important; }
      input, textarea, select, [contenteditable="true"] {
        background-color: #202124 !important; color: #e8eaed !important; border-color: #3c4043 !important;
      }
      a { color: #8ab4f8 !important; }
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
    const view = activeTab && webviews.get(activeTab.id)
    if (view?.canGoBack()) view.goBack()
  }

  function goForward(): void {
    const view = activeTab && webviews.get(activeTab.id)
    if (view?.canGoForward()) view.goForward()
  }

  function reload(): void {
    const view = activeTab && webviews.get(activeTab.id)
    view?.reload()
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
    if (findQuery) findActiveTab()?.findInPage(findQuery)
  }

  function findActiveTab(): BrowserElement | undefined {
    return activeTab ? webviews.get(activeTab.id) : undefined
  }

  function searchPage(): void {
    const view = findActiveTab()
    if (!view) return
    findMatches = 0
    findActive = 0
    if (!findQuery) {
      view.stopFindInPage('clearSelection')
      return
    }
    view.findInPage(findQuery)
  }

  function closeFind(): void {
    findActiveTab()?.stopFindInPage('clearSelection')
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
    void tick().then(() => cancelClearHistoryButton?.focus())
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
    currentProjectId = projectId
    const workspace = workspaceFor(projectId)
    tabs = workspace.tabs
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

<div class="browser-stage">
  <div class="browser-tabs" role="tablist" aria-label="Open browser tabs">
    {#each tabs as tab (tab.id)}
      <div class="browser-tab-shell" class:active={tab.id === activeId}>
        <button type="button" class="browser-tab" role="tab" aria-selected={tab.id === activeId} onclick={() => activateTab(tab.id)}>
          <span class="browser-tab-dot" class:loading={tab.loading}></span>{tab.title}
        </button>
        <button type="button" class="browser-tab-close" aria-label={`Close ${tab.title}`} onclick={() => closeTab(tab.id)}>×</button>
      </div>
    {/each}
    <button type="button" class="browser-tab-new" aria-label="New browser tab" onclick={addTab}>+</button>
  </div>
  <div class="browser-toolbar">
    <div class="browser-nav-actions">
      <button type="button" title="Back" aria-label="Back" disabled={!activeTab || !webviews.get(activeTab.id)?.canGoBack()} onclick={goBack}>‹</button>
      <button type="button" title="Forward" aria-label="Forward" disabled={!activeTab || !webviews.get(activeTab.id)?.canGoForward()} onclick={goForward}>›</button>
      <button type="button" title="Reload" aria-label="Reload" onclick={reload}>{loading ? '×' : '↻'}</button>
    </div>
    <div class="browser-address-wrap">
      <span class="browser-lock">⌁</span>
      <input bind:this={input} bind:value={address} aria-label="Address" placeholder="Enter URL" onkeydown={(event) => event.key === 'Enter' && void navigate()} />
      <button type="button" class="browser-go" onclick={() => void navigate()}>Go</button>
    </div>
    <button type="button" class="browser-home" title="Focus address" aria-label="Focus address" onclick={() => void focusAddress()}>⌘L</button>
    <button type="button" class="browser-home" title="Find in page" aria-label="Find in page" onclick={() => void openFind()}>⌘F</button>
    <button type="button" class="browser-bookmark-toggle" class:active={Boolean(activeBookmark)} title={activeBookmark ? 'Remove bookmark' : 'Bookmark page'} aria-label={activeBookmark ? 'Remove bookmark' : 'Bookmark page'} disabled={!activeTab?.url} onclick={toggleBookmark}>{activeBookmark ? '★' : '☆'}</button>
    <button type="button" class="browser-bookmarks-button" class:active={bookmarksOpen} title="Bookmarks" aria-label="Bookmarks" onclick={() => { historyOpen = false; downloadsOpen = false; bookmarksOpen = !bookmarksOpen }}>Bookmarks</button>
    <button type="button" class="browser-history-button" class:active={historyOpen} title="History" aria-label="History" onclick={() => { bookmarksOpen = false; downloadsOpen = false; historyOpen = !historyOpen }}>History</button>
    <button type="button" class="browser-downloads-button" class:active={downloadsOpen} title="Downloads" aria-label="Downloads" onclick={() => { bookmarksOpen = false; historyOpen = false; downloadsOpen = !downloadsOpen }}>Downloads{#if activeDownloads}<span>{activeDownloads}</span>{/if}</button>
    <button type="button" class="browser-theme" title="Toggle browser theme" aria-label="Toggle browser theme" onclick={() => void toggleTheme()}>{theme === 'dark' ? '☼' : '☾'}</button>
    <button
      type="button"
      class="browser-home"
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
      <div class="browser-find">
        <input bind:this={findInput} bind:value={findQuery} aria-label="Find in page" placeholder="Find" oninput={searchPage} onkeydown={(event) => event.key === 'Escape' && closeFind()} />
        <span>{findMatches ? `${findActive}/${findMatches}` : '—'}</span>
        <button type="button" aria-label="Close find" onclick={closeFind}>×</button>
      </div>
    {/if}
  </div>
  {#if bookmarksOpen}
    <button type="button" class="browser-bookmarks-backdrop" aria-label="Close bookmarks" onclick={() => (bookmarksOpen = false)}></button>
    <section class="browser-bookmarks-panel" aria-label="Bookmarks">
      <header><strong>Bookmarks</strong><span>{bookmarks.length}</span></header>
      <div class="browser-bookmarks-list">
        {#each bookmarks as bookmark (bookmark.id)}
          <div class="browser-bookmark-row">
            {#if editingBookmarkId === bookmark.id}
              <input bind:this={bookmarkRenameInput} bind:value={editingBookmarkTitle} aria-label="Bookmark name" onblur={() => finishBookmarkRename(true)} onkeydown={(event) => { if (event.key === 'Enter') finishBookmarkRename(true); else if (event.key === 'Escape') finishBookmarkRename(false) }} />
            {:else}
              <button type="button" class="browser-bookmark-open" onclick={() => void openBookmark(bookmark)} ondblclick={() => startBookmarkRename(bookmark)}><strong>{bookmark.title}</strong><span>{bookmark.url}</span></button>
              <button type="button" class="browser-bookmark-edit" aria-label={`Rename ${bookmark.title}`} onclick={() => startBookmarkRename(bookmark)}>Rename</button>
              <button type="button" class="browser-bookmark-remove" aria-label={`Remove ${bookmark.title}`} onclick={() => removeBookmark(bookmark.id)}>×</button>
            {/if}
          </div>
        {:else}
          <div class="browser-bookmarks-empty">No bookmarks yet.</div>
        {/each}
      </div>
    </section>
  {/if}
  {#if downloadsOpen}
    <button type="button" class="browser-bookmarks-backdrop" aria-label="Close downloads" onclick={() => (downloadsOpen = false)}></button>
    <section class="browser-bookmarks-panel browser-downloads-panel" aria-label="Downloads">
      <header><strong>Downloads</strong><span>{downloads.length}</span></header>
      <div class="browser-bookmarks-list">
        {#each downloads as download (download.id)}
          <div class="browser-download-row">
            <div class="browser-download-copy"><strong>{download.filename}</strong><span>{download.status === 'progressing' ? `${downloadSize(download.receivedBytes)} / ${download.totalBytes ? downloadSize(download.totalBytes) : '—'}` : download.status}</span></div>
            {#if download.status === 'progressing'}
              <button type="button" onclick={() => void window.enpiistudio.browser.downloads.cancel(download.id)}>Cancel</button>
            {:else if download.status === 'completed'}
              <button type="button" onclick={() => void openDownload(download)}>Open</button><button type="button" onclick={() => void revealDownload(download)}>Folder</button>
            {/if}
            <div class="browser-download-progress"><span style={`width:${downloadProgress(download)}%`}></span></div>
          </div>
        {:else}
          <div class="browser-bookmarks-empty">No downloads yet.</div>
        {/each}
      </div>
    </section>
  {/if}
  {#if historyOpen}
    <button type="button" class="browser-bookmarks-backdrop" aria-label="Close history" onclick={() => (historyOpen = false)}></button>
    <section class="browser-bookmarks-panel browser-history-panel" aria-label="Browser history">
      <header><strong>History</strong><button type="button" disabled={!history.length} onclick={requestClearHistory}>Clear</button></header>
      <div class="browser-history-search"><input bind:value={historyQuery} placeholder="Search history" aria-label="Search history" /></div>
      <div class="browser-bookmarks-list">
        {#each filteredHistory as entry (entry.id)}
          <button type="button" class="browser-history-row" onclick={() => void openHistoryEntry(entry)}><div><strong>{entry.title}</strong><span>{entry.url}</span></div><time>{historyTime(entry.visitedAt)}</time></button>
        {:else}
          <div class="browser-bookmarks-empty">{history.length ? 'No matching history.' : 'No history yet.'}</div>
        {/each}
      </div>
    </section>
  {/if}
  {#if clearHistoryOpen}
    <div class="confirm-backdrop" role="presentation">
      <div class="confirm-dialog" role="dialog" aria-modal="true" aria-label="Clear browser history">
        <div class="confirm-icon">!</div>
        <div><div class="confirm-title">Clear browser history?</div><div class="confirm-message">Semua riwayat browser project ini akan dihapus.</div></div>
        <div class="confirm-actions"><button bind:this={cancelClearHistoryButton} type="button" class="confirm-cancel" onclick={() => (clearHistoryOpen = false)}>Batal</button><button type="button" class="confirm-danger" onclick={clearHistory}>Clear</button></div>
      </div>
    </div>
  {/if}
  {#if error}<div class="browser-error">{error}</div>{/if}
  <div class="browser-content">
    {#each tabs as tab, index (tab.id)}
      <webview
        bind:this={webviewElements[index]}
        class:hidden={tab.id !== activeId}
        src="about:blank"
        partition={browserPartition}
        allowpopups
      ></webview>
    {/each}
    {#if !activeTab?.url && !loading}<div class="browser-empty"><strong>Browser</strong><span>Masukkan URL untuk mulai.</span></div>{/if}
  </div>
</div>
