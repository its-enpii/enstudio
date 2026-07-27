<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { onDestroy } from 'svelte'
  import { EditorState } from '@codemirror/state'
  import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from '@codemirror/language'
  import { tags } from '@lezer/highlight'
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
  import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
  import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
  import { state as app } from '../store.svelte'
  import { createProjectEntry, editProjectFileExact, formatProjectFile, getProjectDiagnostics, listProjectDir, readProjectFile, searchProjectFiles, type ProjectDiagnostic } from '../enpii'
  import { ConfirmDialog } from './ui'

  type Entry = { kind: 'd' | 'f'; name: string; path: string; depth: number }
  type CodeTab = { path: string; content: string; originalContent: string }
  type CodeWorkspace = {
    children: Record<string, Entry[]>
    expanded: Record<string, boolean>
    selectedPath: string | null
    tabs: CodeTab[]
    activeDir: string
    searchQuery: string
    searchResults: string[]
    content: string
    originalContent: string
  }

  let children = $state<Record<string, Entry[]>>({})
  let expanded = $state<Record<string, boolean>>({ '.': true })
  let loadingDirs = $state<Record<string, boolean>>({})
  let selectedPath = $state<string | null>(null)
  let tabs = $state<CodeTab[]>([])
  let pendingClosePath = $state<string | null>(null)
  let activeDir = $state('.')
  let creating = $state<'file' | 'directory' | null>(null)
  let createName = $state('')
  let createInput = $state<HTMLInputElement>()
  let searchQuery = $state('')
  let searchResults = $state<string[]>([])
  let searching = $state(false)
  let toolsOpen = $state(false)
  let toolsMenu = $state<HTMLDetailsElement>()
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchSequence = 0
  let content = $state('')
  let originalContent = $state('')
  let editorHost = $state<HTMLDivElement>()
  let editorView = $state<EditorView>()
  let error = $state('')
  let diagnostics = $state<ProjectDiagnostic[]>([])
  let diagnosticsOpen = $state(false)
  let diagnosticsBusy = $state(false)
  let formatting = $state(false)
  let diagnosticsLoaded = $state(false)
  const diagnosticErrors = $derived(diagnostics.filter((problem) => problem.severity === 'error').length)
  const diagnosticWarnings = $derived(diagnostics.filter((problem) => problem.severity === 'warning').length)
  let currentProjectId: string | null = null
  let switchToken = 0
  const workspaces = new Map<string, CodeWorkspace>()
  const dirty = $derived(selectedPath !== null && content !== originalContent)
  const rows = $derived.by(() => {
    const result: Entry[] = []
    const visit = (dir: string, depth: number): void => {
      for (const entry of children[dir] ?? []) {
        result.push({ ...entry, depth })
        if (entry.kind === 'd' && expanded[entry.path]) visit(entry.path, depth + 1)
      }
    }
    if (expanded['.']) visit('.', 1)
    return result
  })
  function parentPath(file: string): string {
    const index = file.lastIndexOf('/')
    return index < 0 ? '.' : file.slice(0, index)
  }

  function workspaceSnapshot(): CodeWorkspace {
    return {
      children,
      expanded,
      selectedPath,
      tabs,
      activeDir,
      searchQuery,
      searchResults,
      content,
      originalContent,
    }
  }

  function emptyWorkspace(): CodeWorkspace {
    return {
      children: {},
      expanded: { '.': true },
      selectedPath: null,
      tabs: [],
      activeDir: '.',
      searchQuery: '',
      searchResults: [],
      content: '',
      originalContent: '',
    }
  }

  async function switchProject(projectId: string): Promise<void> {
    const token = ++switchToken
    if (currentProjectId) workspaces.set(currentProjectId, workspaceSnapshot())
    currentProjectId = projectId
    const workspace = workspaces.get(projectId) ?? emptyWorkspace()
    workspaces.set(projectId, workspace)
    editorView?.destroy()
    editorView = undefined
    children = workspace.children
    expanded = workspace.expanded
    selectedPath = workspace.selectedPath
    tabs = workspace.tabs
    activeDir = workspace.activeDir
    searchQuery = workspace.searchQuery
    searchResults = workspace.searchResults
    content = workspace.content
    originalContent = workspace.originalContent
    pendingClosePath = null
    creating = null
    toolsOpen = false
    diagnostics = []
    diagnosticsOpen = false
    diagnosticsLoaded = false
    app.codeSelection = null
    await tick()
    if (token !== switchToken || currentProjectId !== projectId) return
    if (selectedPath) await mountEditor(content, selectedPath)
    else if (!children['.']) void loadChildren('.')
  }

  const tomlLanguage = StreamLanguage.define({
    name: 'toml',
    token(stream: StringStream): string | null {
      if (stream.eatSpace()) return null
      if (stream.match(/^#.*/)) return 'comment'
      if (stream.match(/^\[\[?.*?\]\]?/)) return 'typeName'
      if (stream.match(/^(true|false)\b/)) return 'bool'
      if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number'
      if (stream.match(/^"(?:\\.|[^"\\])*"/)) return 'string'
      if (stream.match(/^'(?:[^'])*'/)) return 'string'
      if (stream.match(/^[A-Za-z_][\w.-]*(?=\s*=)/)) return 'propertyName'
      if (stream.match(/^[A-Za-z_][\w.-]*/)) return 'variableName'
      stream.next()
      return null
    },
  })

  async function languageFor(file: string) {
    const name = file.toLowerCase()
    if (name.endsWith('.blade.php') || name.endsWith('.php')) return (await import('@codemirror/lang-php')).php()
    if (name.endsWith('.vue')) return (await import('@codemirror/lang-vue')).vue()
    if (name.endsWith('.tsx')) return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true })
    if (name.endsWith('.ts')) return (await import('@codemirror/lang-javascript')).javascript({ typescript: true })
    if (name.endsWith('.jsx')) return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
    if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return (await import('@codemirror/lang-javascript')).javascript()
    if (name.endsWith('.css')) return (await import('@codemirror/lang-css')).css()
    if (name.endsWith('.json')) return (await import('@codemirror/lang-json')).json()
    if (name.endsWith('.yaml') || name.endsWith('.yml')) return (await import('@codemirror/lang-yaml')).yaml()
    if (name.endsWith('.md') || name.endsWith('.markdown')) return (await import('@codemirror/lang-markdown')).markdown()
    if (name.endsWith('.py')) return (await import('@codemirror/lang-python')).python()
    if (name.endsWith('.toml')) return tomlLanguage
    return []
  }

  const enpiiEditorTheme = EditorView.theme({
    '&': {
      backgroundColor: 'transparent',
      color: '#e2e2e2',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: '12px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': { caretColor: '#e6af2e', padding: '18px 32px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e6af2e', borderLeftWidth: '2px' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(86, 132, 255, 0.38)' },
    '.cm-gutters': { backgroundColor: 'rgba(255, 255, 255, 0.018)', borderRight: '1px solid rgba(255, 255, 255, 0.04)', color: 'rgba(255, 255, 255, 0.28)' },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '36px', padding: '0 8px', textAlign: 'right' },
  }, { dark: true })

  const enpiiHighlightStyle = HighlightStyle.define([
    { tag: tags.comment, color: '#737884', fontStyle: 'italic' },
    { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.modifier], color: '#c792ea' },
    { tag: [tags.operator, tags.operatorKeyword], color: '#89a7ff' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#a8d98f' },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#e6af2e' },
    { tag: [tags.function(tags.variableName), tags.labelName], color: '#7dd3fc' },
    { tag: [tags.definition(tags.variableName), tags.variableName], color: '#e2e2e2' },
    { tag: [tags.propertyName, tags.attributeName], color: '#82aaff' },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: '#d6a9ff' },
    { tag: [tags.heading, tags.strong], color: '#f0c96a', fontWeight: '600' },
    { tag: [tags.link, tags.url], color: '#67d4d0', textDecoration: 'underline' },
    { tag: [tags.meta, tags.annotation, tags.processingInstruction], color: '#ff9f7a' },
    { tag: [tags.invalid], color: '#ff6b81', textDecoration: 'underline wavy' },
  ])

  function joinPath(base: string, name: string): string {
    return base === '.' ? name : `${base}/${name}`
  }

  function duplicateLine(direction: 'up' | 'down'): boolean {
    if (!editorView) return false
    const state = editorView.state
    const line = state.doc.lineAt(state.selection.main.head)
    const text = `${line.text}\n`
    const pos = direction === 'up' ? line.from : line.to
    editorView.dispatch({ changes: { from: pos, insert: text } })
    return true
  }

  function syncCurrentTab(): void {
    if (!selectedPath) return
    const tab = tabs.find((item) => item.path === selectedPath)
    if (tab) tab.content = content
  }

  async function activateTab(tab: CodeTab): Promise<void> {
    if (tab.path === selectedPath) return
    syncCurrentTab()
    editorView?.destroy()
    editorView = undefined
    selectedPath = tab.path
    content = tab.content
    originalContent = tab.originalContent
    await tick()
    await mountEditor(tab.content, tab.path)
  }

  async function closeTab(path: string): Promise<void> {
    const tab = tabs.find((item) => item.path === path)
    if (!tab) return
    const index = tabs.findIndex((item) => item.path === path)
    tabs = tabs.filter((item) => item.path !== path)
    if (selectedPath !== path) return
    editorView?.destroy()
    editorView = undefined
    const next = tabs[index] ?? tabs[index - 1]
    if (next) await activateTab(next)
    else {
      selectedPath = null
      content = ''
      originalContent = ''
      app.codeSelection = null
    }
  }

  function requestCloseTab(path: string): void {
    const tab = tabs.find((item) => item.path === path)
    if (!tab) return
    if (tab.content !== tab.originalContent) pendingClosePath = path
    else void closeTab(path)
  }

  function resolveClose(shouldClose: boolean): void {
    const path = pendingClosePath
    pendingClosePath = null
    if (shouldClose && path) void closeTab(path)
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && toolsOpen) toolsOpen = false
  }

  function onWindowClick(event: MouseEvent): void {
    if (toolsOpen && !toolsMenu?.contains(event.target as Node)) toolsOpen = false
  }

  function toggleRoot(): void {
    expanded['.'] = !expanded['.']
    expanded = { ...expanded }
    activeDir = '.'
  }

  function beginCreate(kind: 'file' | 'directory'): void {
    creating = kind
    createName = ''
    void tick().then(() => createInput?.focus())
  }

  async function submitCreate(): Promise<void> {
    const project = app.activeProject
    const kind = creating
    const name = createName.trim()
    if (!project || !kind || !name) return
    error = ''
    try {
      const created = await createProjectEntry(project.path, activeDir, name, kind)
      creating = null
      createName = ''
      expanded['.'] = true
      expanded[activeDir] = true
      expanded = { ...expanded }
      await loadChildren(activeDir, true)
      if (kind === 'file') await readPath(created.path)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function scheduleSearch(value: string): void {
    searchQuery = value
    if (searchTimer) clearTimeout(searchTimer)
    if (!value.trim()) {
      searchResults = []
      searching = false
      return
    }
    searchTimer = setTimeout(() => void runSearch(value), 180)
  }

  async function runSearch(query: string): Promise<void> {
    const project = app.activeProject
    if (!project) return
    const sequence = ++searchSequence
    searching = true
    try {
      const result = await searchProjectFiles(project.path, query)
      if (sequence !== searchSequence) return
      searchResults = result.content && result.content !== '(no matches)' ? result.content.split('\n').filter(Boolean) : []
    } catch (err) {
      if (sequence === searchSequence) error = err instanceof Error ? err.message : String(err)
    } finally {
      if (sequence === searchSequence) searching = false
    }
  }

  async function mountEditor(doc: string, file: string): Promise<void> {
    editorView?.destroy()
    if (!editorHost) return
    const language = await languageFor(file)
    if (!editorHost || selectedPath !== file) return
    editorView = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          enpiiEditorTheme,
          syntaxHighlighting(enpiiHighlightStyle),
          language,
          search(),
          keymap.of([
            { key: 'Mod-s', run: () => { if (dirty && !app.busy) void saveExact(); return true } },
            { key: 'Alt-ArrowUp', run: () => duplicateLine('up') },
            { key: 'Alt-ArrowDown', run: () => duplicateLine('down') },
            { key: 'Mod-h', run: openSearchPanel },
            { key: 'Mod-Shift-f', run: () => { void formatDocument(); return true } },
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              content = update.state.doc.toString()
              const tab = tabs.find((item) => item.path === selectedPath)
              if (tab) tab.content = content
            }
            if (update.docChanged || update.selectionSet) {
              const main = update.state.selection.main
              if (!selectedPath || main.empty) {
                if (app.codeSelection?.path === selectedPath) app.codeSelection = null
              } else {
                const from = update.state.doc.lineAt(main.from)
                const to = update.state.doc.lineAt(main.to)
                const text = update.state.sliceDoc(main.from, main.to)
                if (text.trim()) {
                  app.codeSelection = {
                    path: selectedPath,
                    startLine: from.number,
                    endLine: to.number,
                    text: text.slice(0, 40_000),
                  }
                } else if (app.codeSelection?.path === selectedPath) {
                  app.codeSelection = null
                }
              }
            }
          }),
        ],
      }),
      parent: editorHost,
    })
  }

  function goToLine(line: number): void {
    if (!editorView) return
    const safeLine = Math.min(Math.max(line, 1), editorView.state.doc.lines)
    const target = editorView.state.doc.line(safeLine)
    editorView.dispatch({ selection: { anchor: target.from }, scrollIntoView: true })
    editorView.focus()
  }

  async function runDiagnostics(openPanel = true): Promise<void> {
    const project = app.activeProject
    if (!project) return
    diagnosticsBusy = true
    error = ''
    try {
      diagnostics = await getProjectDiagnostics(project.path, selectedPath ?? undefined)
      diagnosticsLoaded = true
      if (openPanel) diagnosticsOpen = true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      diagnosticsBusy = false
    }
  }

  async function openDiagnostic(problem: ProjectDiagnostic): Promise<void> {
    await revealPath(problem.path)
    goToLine(problem.line)
  }

  async function formatDocument(): Promise<void> {
    const project = app.activeProject
    if (!project || !selectedPath || formatting) return
    formatting = true
    error = ''
    try {
      const result = await formatProjectFile(project.path, selectedPath, content)
      editorView?.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: result.content } })
      content = result.content
      const tab = tabs.find((item) => item.path === selectedPath)
      if (tab) tab.content = result.content
      app.pushLog(`[code] formatted ${selectedPath} (${result.formatter})`)
      app.notify('success', 'Document formatted', selectedPath)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      app.notify('error', 'Format failed', error)
    } finally {
      formatting = false
    }
  }

  async function loadChildren(dir: string, force = false): Promise<void> {
    const project = app.activeProject
    if (!project || (children[dir] && !force)) return
    const projectId = project.id
    loadingDirs[dir] = true
    loadingDirs = { ...loadingDirs }
    error = ''
    try {
      const result = await listProjectDir(project.path, dir)
      if (app.activeProjectId !== projectId) return
      children[dir] = result.content.split('\n')
        .map((row) => row.match(/^([df]) (.+)$/))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map((match) => ({ kind: match[1] as 'd' | 'f', name: match[2], path: joinPath(dir, match[2]), depth: 0 }))
        .sort((a, b) => Number(b.kind === 'd') - Number(a.kind === 'd') || a.name.localeCompare(b.name))
      children = { ...children }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loadingDirs[dir] = false
      loadingDirs = { ...loadingDirs }
    }
  }

  async function readPath(file: string): Promise<void> {
    const project = app.activeProject
    if (!project) return
    const projectId = project.id
    error = ''
    try {
      const result = await readProjectFile(project.path, file)
      if (app.activeProjectId !== projectId) return
      editorView?.destroy()
      editorView = undefined
      selectedPath = file
      activeDir = parentPath(file)
      content = result.content
      originalContent = result.content
      const existing = tabs.find((tab) => tab.path === file)
      if (existing) {
        content = existing.content
        originalContent = existing.originalContent
      } else {
        tabs = [...tabs, { path: file, content: result.content, originalContent: result.content }]
      }
      await tick()
      await mountEditor(content, file)
      if (!diagnosticsLoaded) void runDiagnostics(false)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function toggleDirectory(entry: Entry): Promise<void> {
    activeDir = entry.path
    if (expanded[entry.path]) expanded[entry.path] = false
    else {
      await loadChildren(entry.path)
      expanded[entry.path] = true
    }
    expanded = { ...expanded }
  }

  async function openEntry(entry: Entry): Promise<void> {
    if (entry.kind === 'd') await toggleDirectory(entry)
    else await readPath(entry.path)
  }

  async function revealPath(file: string): Promise<void> {
    const clean = file.replace(/\\/g, '/').replace(/^\.\//, '')
    let dir = '.'
    await loadChildren('.')
    for (const name of clean.split('/').slice(0, -1)) {
      dir = joinPath(dir, name)
      await loadChildren(dir)
      expanded[dir] = true
    }
    expanded = { ...expanded }
    await readPath(clean)
  }

  async function saveExact(): Promise<void> {
    if (!selectedPath || !dirty) return
    const file = selectedPath
    try {
      await editProjectFileExact(file, originalContent, content)
      originalContent = content
      const tab = tabs.find((item) => item.path === file)
      if (tab) tab.originalContent = content
      app.pushLog(`[code] saved exact ${file}`)
      app.notify('success', 'File saved', file)
      void runDiagnostics(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      app.pushLog(`[code] save failed: ${message}`)
      app.pushMessage({ role: 'system', text: message })
      app.notify('error', 'Save failed', message)
    }
  }

  $effect(() => {
    const projectId = app.activeProjectId
    if (projectId) untrack(() => void switchProject(projectId))
  })

  $effect(() => {
    const requested = app.codePath
    if (!requested) return
    const line = app.codeLine
    app.codePath = null
    app.codeLine = null
    void revealPath(requested).then(() => line && goToLine(line))
  })

  onDestroy(() => {
    editorView?.destroy()
    if (searchTimer) clearTimeout(searchTimer)
  })
</script>

<svelte:window onkeydown={onWindowKeydown} onclick={onWindowClick} />

<div class="stage code-stage">
  {#if !app.activeProject}
    <div class="placeholder-stage"><div><div class="ph-title">Open a project</div><div class="muted">Code mode needs a workspace.</div></div></div>
  {:else}
    <div class="code-layout mac-code-layout">
      <aside class="code-tree custom-scrollbar">
        <div class="code-tree-toolbar">
          <div class="code-search-wrap">
            <span class="code-search-icon">⌕</span>
            <input class="code-search" value={searchQuery} placeholder="Search files" aria-label="Search project files" oninput={(event) => scheduleSearch(event.currentTarget.value)} />
          </div>
          <details class="code-tree-menu" bind:this={toolsMenu} bind:open={toolsOpen}>
            <summary title="File actions" aria-label="File actions">•••</summary>
            <div class="code-tree-menu-popover">
              <button type="button" onclick={() => { toolsOpen = false; beginCreate('file') }}>New File</button>
              <button type="button" onclick={() => { toolsOpen = false; beginCreate('directory') }}>New Folder</button>
            </div>
          </details>
        </div>
        <button type="button" class="tree-root" class:selected={activeDir === '.'} onclick={toggleRoot}><span class="tree-chevron">{expanded['.'] ? '⌄' : '›'}</span><span class="folder-icon">▰</span><span>{app.activeProject.name}</span></button>
        {#if creating}
          <form class="tree-create-row" onsubmit={(event) => { event.preventDefault(); void submitCreate() }}>
            <span>{creating === 'file' ? '◻' : '▰'}</span>
            <input bind:this={createInput} bind:value={createName} placeholder={creating === 'file' ? 'filename' : 'folder name'} onblur={() => { creating = null; createName = '' }} onkeydown={(event) => { if (event.key === 'Escape') { creating = null; createName = '' } }} />
          </form>
        {/if}
        {#if searchQuery.trim()}
          {#if searching}<div class="muted tree-loading">Searching…</div>
          {:else if searchResults.length === 0}<div class="muted tree-loading">No files found</div>
          {:else}{#each searchResults as file (file)}
            <button type="button" class="code-entry search-result" class:selected={selectedPath === file} onclick={() => void revealPath(file)}>
              <span class="tree-file-icon">◻</span><span class="tree-name">{file}</span>
            </button>
          {/each}{/if}
        {:else}
          {#if loadingDirs['.'] && rows.length === 0}<div class="muted tree-loading">Loading…</div>{/if}
          {#each rows as entry (entry.path)}
            <button type="button" class="code-entry" class:directory={entry.kind === 'd'} class:selected={selectedPath === entry.path || activeDir === entry.path} style={`padding-left:${10 + entry.depth * 16}px`} onclick={() => void openEntry(entry)}>
              <span class="tree-chevron">{entry.kind === 'd' ? expanded[entry.path] ? '⌄' : '›' : ''}</span>
              <span class="tree-file-icon">{entry.kind === 'd' ? '▰' : '◻'}</span>
              <span class="tree-name">{entry.name}</span>
              {#if loadingDirs[entry.path]}<span class="tree-spinner">···</span>{/if}
            </button>
          {/each}
        {/if}
      </aside>
      <section class="code-preview">
        {#if error}<div class="code-error">{error}</div>
        {:else if selectedPath}
          <div class="code-tabs" role="tablist" aria-label="Open files">
            {#each tabs as tab (tab.path)}
              <div class="code-tab-shell" class:active={tab.path === selectedPath}>
                <button type="button" class="code-tab" role="tab" aria-selected={tab.path === selectedPath} onclick={() => void activateTab(tab)}>
                  {#if tab.content !== tab.originalContent}<span class="code-tab-dirty" aria-label="Unsaved changes">●</span>{/if}
                  <span class="code-tab-name">{tab.path.split('/').at(-1)}</span>
                </button>
                <button type="button" class="code-tab-close" aria-label={`Close ${tab.path}`} onclick={() => requestCloseTab(tab.path)}>×</button>
              </div>
            {/each}
            <button type="button" class="code-problems-toggle" class:has-errors={diagnosticErrors > 0} class:has-warnings={diagnosticErrors === 0 && diagnosticWarnings > 0} disabled={diagnosticsBusy} title={dirty ? 'Showing saved-file diagnostics; save to refresh' : 'Open Problems'} onclick={() => { diagnosticsOpen = !diagnosticsOpen; if (diagnosticsOpen && !diagnosticsLoaded && !dirty) void runDiagnostics() }}><span>Problems</span>{#if diagnosticErrors > 0}<span class="problem-badge error">{diagnosticErrors}</span>{:else if diagnosticWarnings > 0}<span class="problem-badge warning">{diagnosticWarnings}</span>{/if}{#if diagnosticsBusy}<span class="problem-spinner">···</span>{/if}</button>
          </div>
          <div class="code-file-head mono"><span>{selectedPath}</span><span class="code-file-actions"><button type="button" disabled={formatting} title="Format Document (Cmd/Ctrl+Shift+F)" onclick={() => void formatDocument()}>{formatting ? 'Formatting…' : 'Format'}</button>{#if dirty}<span class="dirty-dot">Edited · Cmd/Ctrl+S</span>{/if}</span></div>
          <div class="cm-editor-host" bind:this={editorHost}></div>
          {#if diagnosticsOpen}
            <section class="problems-panel">
              <header><strong>Problems</strong><span>{diagnostics.length}</span><button type="button" disabled={diagnosticsBusy} onclick={() => void runDiagnostics()}>Refresh</button><button type="button" aria-label="Close problems" onclick={() => (diagnosticsOpen = false)}>×</button></header>
              <div class="problems-list custom-scrollbar">
                {#if dirty}<div class="problems-notice">File belum disimpan. Badge diperbarui otomatis setelah save.</div>{/if}
                {#if diagnosticsLoaded && diagnostics.length === 0}<div class="problems-empty">No problems found.</div>{:else if !diagnosticsLoaded}<div class="problems-empty">Save file or click Refresh to run diagnostics.</div>{/if}
                {#each diagnostics as problem, index (`${problem.path}:${problem.line}:${problem.column}:${index}`)}
                  <button type="button" class="problem-row {problem.severity}" onclick={() => void openDiagnostic(problem)}><span class="problem-icon">{problem.severity === 'error' ? '×' : '!'}</span><span class="problem-copy"><strong>{problem.message}</strong><small>{problem.path}:{problem.line}:{problem.column} · {problem.source}{#if problem.code} · {problem.code}{/if}</small></span></button>
                {/each}
              </div>
            </section>
          {/if}
        {:else}<div class="code-empty"><div class="ph-title">Select a file</div><div class="muted">Expand folders in the sidebar. Root stays visible.</div></div>{/if}
      </section>
    </div>
  {/if}
</div>

<ConfirmDialog
  open={pendingClosePath != null}
  title="File belum disimpan"
  message={pendingClosePath ? `Tutup ${pendingClosePath} tanpa menyimpan perubahan?` : ''}
  cancelLabel="Batal"
  confirmLabel="Tutup tanpa simpan"
  danger
  onCancel={() => resolveClose(false)}
  onConfirm={() => resolveClose(true)}
/>
