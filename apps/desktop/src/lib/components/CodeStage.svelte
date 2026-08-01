<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { onDestroy, onMount } from 'svelte'
  import { Compartment, EditorState } from '@codemirror/state'
  import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from '@codemirror/language'
  import { tags } from '@lezer/highlight'
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
  import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
  import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
  import { state as app, fontStack, EDITOR_FONT_SIZE } from '../store.svelte'
  import {
    createProjectEntry,
    deleteProjectEntry,
    editProjectFileExact,
    formatProjectFile,
    getProjectDiagnostics,
    listProjectDir,
    readProjectFile,
    renameProjectEntry,
    searchProjectFiles,
    type ProjectDiagnostic,
  } from '../enpii'
  import { color } from '../theme'
  import { t } from '../i18n/index.svelte'
  import { ConfirmDialog, TextInput } from './ui'
  import { Icon } from '../icons'
  import { syncCodePanel } from '../code-panel.svelte'

  type Entry = { kind: 'd' | 'f'; name: string; path: string; depth: number }
  type CodeTab = { path: string; content: string; originalContent: string; preview?: boolean }
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
  /** Parent dir for inline create (not always root). */
  let createParent = $state('.')
  let createName = $state('')
  let createInput = $state<HTMLInputElement>()
  let renamingPath = $state<string | null>(null)
  let renameName = $state('')
  let renameInput = $state<HTMLInputElement>()
  let pendingDeletePath = $state<string | null>(null)
  let ctxMenu = $state<null | { x: number; y: number; entry: Entry | { kind: 'd'; name: string; path: '.' } }>(null)
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

  $effect(() => {
    syncCodePanel({
      path: selectedPath,
      content,
      originalContent,
    })
  })
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

  const themeCompartment = new Compartment()

  function buildEditorTheme(fontFamily: string) {
    return EditorView.theme({
      '&': {
        backgroundColor: 'transparent',
        color: color.text,
        fontFamily,
        fontSize: `${EDITOR_FONT_SIZE}px`,
        lineHeight: '1.55',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-content': { caretColor: color.gold, padding: '8px 12px 8px 4px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: color.gold, borderLeftWidth: '2px' },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(86, 132, 255, 0.38)' },
      '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid rgba(255, 255, 255, 0.06)', color: 'rgba(255, 255, 255, 0.32)', paddingLeft: '4px' },
      '.cm-lineNumbers .cm-gutterElement': {
        minWidth: '32px',
        padding: '0 8px 0 4px',
        textAlign: 'right',
        fontSize: `${EDITOR_FONT_SIZE - 1}px`,
      },
    }, { dark: true })
  }

  // Family change only — size comes from whole-UI zoom.
  $effect(() => {
    const theme = buildEditorTheme(fontStack(app.ui.fontFamily))
    void app.ui.uiZoom
    editorView?.dispatch({ effects: themeCompartment.reconfigure(theme) })
  })

  const enpiiHighlightStyle = HighlightStyle.define([
    { tag: tags.comment, color: color.comment, fontStyle: 'italic' },
    { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.modifier], color: color.keyword },
    { tag: [tags.operator, tags.operatorKeyword], color: color.operator },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: color.string },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: color.gold },
    { tag: [tags.function(tags.variableName), tags.labelName], color: color.fn },
    { tag: [tags.definition(tags.variableName), tags.variableName], color: color.text },
    { tag: [tags.propertyName, tags.attributeName], color: color.operator },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: color.lavenderSoft },
    { tag: [tags.heading, tags.strong], color: color.amber, fontWeight: '600' },
    { tag: [tags.link, tags.url], color: color.link, textDecoration: 'underline' },
    { tag: [tags.meta, tags.annotation, tags.processingInstruction], color: color.errorSoft },
    { tag: [tags.invalid], color: color.errorBright, textDecoration: 'underline wavy' },
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
    if (event.key === 'Escape') {
      if (toolsOpen) toolsOpen = false
      if (ctxMenu) ctxMenu = null
    }
  }

  function onAppShortcut(shortcut: string): void {
    // main steals Mod+W via before-input-event → browser:shortcut
    if (shortcut !== 'close-tab' || app.mode !== 'code' || !selectedPath) return
    requestCloseTab(selectedPath)
  }

  function onWindowClick(event: MouseEvent): void {
    if (toolsOpen && !toolsMenu?.contains(event.target as Node)) toolsOpen = false
    if (ctxMenu) ctxMenu = null
  }

  function toggleRoot(): void {
    expanded['.'] = !expanded['.']
    expanded = { ...expanded }
    activeDir = '.'
  }

  function beginCreate(kind: 'file' | 'directory', parentDir?: string): void {
    const parent = parentDir ?? activeDir ?? '.'
    createParent = parent
    activeDir = parent
    creating = kind
    createName = ''
    renamingPath = null
    ctxMenu = null
    // Ensure parent is expanded so the inline field is visible under it.
    expanded['.'] = true
    if (parent !== '.') expanded[parent] = true
    expanded = { ...expanded }
    void tick().then(() => createInput?.focus())
  }

  async function expandToPath(rel: string): Promise<void> {
    const clean = rel.replace(/\\/g, '/').replace(/^\.\//, '')
    const segs = clean.split('/').filter(Boolean)
    let dir = '.'
    await loadChildren('.', true)
    expanded['.'] = true
    for (let i = 0; i < segs.length - 1; i++) {
      dir = joinPath(dir, segs[i]!)
      await loadChildren(dir, true)
      expanded[dir] = true
    }
    expanded = { ...expanded }
  }

  async function submitCreate(): Promise<void> {
    const project = app.activeProject
    const kind = creating
    const name = createName.trim().replace(/\\/g, '/')
    const parent = createParent || activeDir || '.'
    if (!project || !kind || !name) return
    error = ''
    try {
      const created = await createProjectEntry(project.path, parent, name, kind)
      creating = null
      createName = ''
      await expandToPath(created.path)
      // Refresh all ancestors so tree shows new nodes.
      const parts = created.path.split('/')
      let d = '.'
      await loadChildren('.', true)
      for (let i = 0; i < parts.length - 1; i++) {
        d = joinPath(d, parts[i]!)
        await loadChildren(d, true)
      }
      if (kind === 'directory') {
        activeDir = created.path
        await loadChildren(created.path, true)
        expanded[created.path] = true
        expanded = { ...expanded }
      } else {
        activeDir = parentPath(created.path)
        await readPath(created.path, { pin: true })
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function openCtx(e: MouseEvent, entry: Entry | { kind: 'd'; name: string; path: '.' }): void {
    e.preventDefault()
    e.stopPropagation()
    ctxMenu = {
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 200),
      entry,
    }
    if (entry.kind === 'd') activeDir = entry.path
  }

  function beginRename(entry: Entry): void {
    ctxMenu = null
    renamingPath = entry.path
    renameName = entry.name
    creating = null
    void tick().then(() => {
      renameInput?.focus()
      renameInput?.select()
    })
  }

  async function submitRename(): Promise<void> {
    const project = app.activeProject
    const from = renamingPath
    const name = renameName.trim()
    if (!project || !from || !name || name === from.split('/').pop()) {
      renamingPath = null
      return
    }
    error = ''
    try {
      const res = await renameProjectEntry(project.path, from, name)
      renamingPath = null
      const parent = parentPath(from)
      await loadChildren(parent === '.' ? '.' : parent, true)
      // Update open tabs
      tabs = tabs.map((t) =>
        t.path === from || t.path.startsWith(`${from}/`)
          ? { ...t, path: t.path === from ? res.path : `${res.path}${t.path.slice(from.length)}` }
          : t,
      )
      if (selectedPath === from) selectedPath = res.path
      else if (selectedPath?.startsWith(`${from}/`)) {
        selectedPath = `${res.path}${selectedPath.slice(from.length)}`
      }
      if (activeDir === from) activeDir = res.path
      if (selectedPath === res.path) await readPath(res.path, { pin: true })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function requestDelete(entry: Entry): void {
    ctxMenu = null
    pendingDeletePath = entry.path
  }

  async function confirmDelete(): Promise<void> {
    const project = app.activeProject
    const path = pendingDeletePath
    pendingDeletePath = null
    if (!project || !path) return
    error = ''
    try {
      await deleteProjectEntry(project.path, path)
      const parent = parentPath(path)
      // Close tabs under deleted path
      const doomed = tabs.filter((t) => t.path === path || t.path.startsWith(`${path}/`)).map((t) => t.path)
      for (const p of doomed) {
        tabs = tabs.filter((t) => t.path !== p)
        if (selectedPath === p) {
          selectedPath = null
          content = ''
          originalContent = ''
          editorView?.destroy()
          editorView = undefined
        }
      }
      if (activeDir === path || activeDir.startsWith(`${path}/`)) activeDir = parent
      delete children[path]
      children = { ...children }
      await loadChildren(parent, true)
      if (tabs.length && !selectedPath) await activateTab(tabs[tabs.length - 1]!)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function copyPath(entry: Entry | { path: string }, relative: boolean): Promise<void> {
    ctxMenu = null
    const project = app.activeProject
    if (!project) return
    const rel = entry.path === '.' ? '' : entry.path.replace(/\\/g, '/')
    const text = relative
      ? rel || '.'
      : rel
        ? `${project.path.replace(/[\\/]+$/, '')}/${rel}`.replace(/\//g, project.path.includes('\\') ? '\\' : '/')
        : project.path
    try {
      await navigator.clipboard.writeText(text)
      app.notify('success', relative ? 'Relative path copied' : 'Path copied', text)
    } catch {
      app.notify('error', 'Copy failed', text)
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
          themeCompartment.of(buildEditorTheme(fontStack(app.ui.fontFamily))),
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
              if (tab) {
                tab.content = content
                // Edit pins preview → permanent tab
                if (tab.preview && content !== tab.originalContent) {
                  tab.preview = false
                  tabs = [...tabs]
                }
              }
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

  async function refreshVisibleTree(): Promise<void> {
    if (!app.activeProject) return
    await loadChildren('.', true)
    const loadedDirs = Object.keys(children)
      .filter((dir) => dir !== '.' && expanded[dir])
      .sort((a, b) => a.split('/').length - b.split('/').length)
    for (const dir of loadedDirs) {
      const parent = parentPath(dir)
      if (!(children[parent] ?? []).some((entry) => entry.kind === 'd' && entry.path === dir)) continue
      await loadChildren(dir, true)
    }
  }

  async function readPath(file: string, opts: { pin?: boolean } = {}): Promise<void> {
    const project = app.activeProject
    if (!project) return
    const projectId = project.id
    error = ''
    try {
      const result = await readProjectFile(project.path, file)
      if (app.activeProjectId !== projectId) return
      syncCurrentTab()
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
        if (opts.pin) existing.preview = false
        tabs = [...tabs]
      } else if (opts.pin) {
        // Permanent open (create/reveal/double-click)
        tabs = [...tabs, { path: file, content: result.content, originalContent: result.content, preview: false }]
      } else {
        // Single-click preview: replace existing clean preview tab
        const previewIdx = tabs.findIndex((tab) => tab.preview && tab.content === tab.originalContent)
        if (previewIdx >= 0) {
          const next = [...tabs]
          next[previewIdx] = { path: file, content: result.content, originalContent: result.content, preview: true }
          tabs = next
        } else {
          tabs = [...tabs, { path: file, content: result.content, originalContent: result.content, preview: true }]
        }
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

  async function pinEntry(entry: Entry): Promise<void> {
    if (entry.kind === 'd') await toggleDirectory(entry)
    else await readPath(entry.path, { pin: true })
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
    // Agent/jump open pins — user likely wants it kept
    await readPath(clean, { pin: true })
  }

  async function saveExact(): Promise<void> {
    if (!selectedPath || !dirty) return
    const file = selectedPath
    try {
      await editProjectFileExact(file, originalContent, content)
      originalContent = content
      const tab = tabs.find((item) => item.path === file)
      if (tab) {
        tab.originalContent = content
        tab.preview = false
      }
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

  onMount(() => {
    // Electron main routes Mod+W through browser:shortcut (always preventDefault)
    const off = window.enpiistudio?.browser?.onShortcut?.(onAppShortcut)
    const refreshOnFocus = (): void => {
      void refreshVisibleTree()
    }
    const refreshOnVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshVisibleTree()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      off?.()
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  })

  onDestroy(() => {
    editorView?.destroy()
    if (searchTimer) clearTimeout(searchTimer)
  })
</script>

<svelte:window onkeydown={onWindowKeydown} onclick={onWindowClick} />

<div class="flex h-full min-h-0 w-full flex-col">
  {#if !app.activeProject}
    <div class="m-4 grid h-[calc(100%-32px)] place-items-center rounded-lg border border-dashed border-border-subtle text-studio-text-dim">
      <div class="text-center">
        <div class="mb-1.5 font-semibold text-white">{t('code.openProject')}</div>
        <div class="text-xs">{t('code.needsWorkspace')}</div>
      </div>
    </div>
  {:else}
    <div class="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
      <aside class="overflow-auto border-r border-border-subtle p-4">
        <div class="mb-2 flex items-center gap-1">
          <TextInput
            class="min-w-0 flex-1"
            value={searchQuery}
            placeholder={t('code.searchFiles')}
            aria-label="Search project files"
            oninput={(event) => scheduleSearch(event.currentTarget.value)}
          />
          <details class="relative" bind:this={toolsMenu} bind:open={toolsOpen}>
            <summary
              class="grid size-7 cursor-pointer place-items-center list-none rounded-md text-studio-text-dim hover:bg-white/5 hover:text-studio-text [&::-webkit-details-marker]:hidden"
              title="File actions"
              aria-label="File actions"><Icon name="more-vertical" size={14} /></summary
            >
            <div class="absolute right-0 z-20 mt-1 grid min-w-[140px] gap-0.5 rounded-lg border border-border-subtle bg-studio-card p-1 shadow-xl">
              <button type="button" class="rounded px-2.5 py-1.5 text-left text-xs text-studio-text hover:bg-white/5" onclick={() => { toolsOpen = false; beginCreate('file', activeDir) }}>New File</button>
              <button type="button" class="rounded px-2.5 py-1.5 text-left text-xs text-studio-text hover:bg-white/5" onclick={() => { toolsOpen = false; beginCreate('directory', activeDir) }}>New Folder</button>
            </div>
          </details>
        </div>
        <button
          type="button"
          class="mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs {activeDir === '.'
            ? 'bg-studio-purple/25 text-studio-text ring-1 ring-studio-purple/30'
            : 'text-studio-text-dim hover:bg-white/[0.06] hover:text-studio-text'}"
          onclick={toggleRoot}
          oncontextmenu={(e) => openCtx(e, { kind: 'd', name: app.activeProject ? app.projectLabel(app.activeProject) : 'root', path: '.' })}
        >
          <span class="grid w-3 place-items-center text-studio-text-dim"
            ><Icon name={expanded['.'] ? 'chevron-down' : 'chevron-right'} size={10} /></span
          >
          <Icon name="folder" size={12} class="shrink-0 text-studio-text-dim" />
          <span class="truncate">{app.projectLabel(app.activeProject)}</span>
        </button>
        {#if creating && createParent === '.'}
          <form class="mb-1 flex items-center gap-1.5 px-2" style="padding-left:26px" onsubmit={(event) => { event.preventDefault(); void submitCreate() }}>
            <Icon name={creating === 'file' ? 'file' : 'folder'} size={12} class="shrink-0 text-studio-text-dim" />
            <input
              class="min-w-0 flex-1 rounded border border-studio-purple/50 bg-studio-dark px-1.5 py-0.5 text-xs text-studio-text outline-none"
              bind:this={createInput}
              bind:value={createName}
              placeholder={creating === 'file' ? 'path/to/file.ts' : 'folder or nested/path'}
              onblur={() => { if (!createName.trim()) { creating = null; createName = '' } }}
              onkeydown={(event) => { if (event.key === 'Escape') { creating = null; createName = '' } }}
            />
          </form>
        {/if}
        {#if searchQuery.trim()}
          {#if searching}
            <div class="p-4 text-xs text-studio-text-dim">Searching…</div>
          {:else if searchResults.length === 0}
            <div class="p-4 text-xs text-studio-text-dim">No files found</div>
          {:else}
            {#each searchResults as file (file)}
              <button
                type="button"
                class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs {selectedPath === file
                  ? 'bg-studio-purple/25 text-studio-text ring-1 ring-studio-purple/30'
                  : 'text-studio-text-dim hover:bg-white/[0.06] hover:text-studio-text'}"
                onclick={() => void revealPath(file)}
              >
                <Icon name="file" size={12} class="shrink-0" /><span class="truncate">{file}</span>
              </button>
            {/each}
          {/if}
        {:else}
          {#if loadingDirs['.'] && rows.length === 0}
            <div class="p-4 text-xs text-studio-text-dim">Loading…</div>
          {/if}
          {#each rows as entry (entry.path)}
            {#if renamingPath === entry.path}
              <form
                class="mb-0.5 flex items-center gap-1.5 py-1 pr-2"
                style={`padding-left:${8 + entry.depth * 12}px`}
                onsubmit={(event) => { event.preventDefault(); void submitRename() }}
              >
                <Icon name={entry.kind === 'd' ? 'folder' : 'file'} size={12} class="shrink-0 text-studio-text-dim" />
                <input
                  class="min-w-0 flex-1 rounded border border-studio-purple/50 bg-studio-dark px-1.5 py-0.5 text-xs text-studio-text outline-none"
                  bind:this={renameInput}
                  bind:value={renameName}
                  onblur={() => void submitRename()}
                  onkeydown={(event) => { if (event.key === 'Escape') { renamingPath = null } }}
                />
              </form>
            {:else}
              <button
                type="button"
                class="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs {selectedPath === entry.path || activeDir === entry.path
                  ? 'bg-studio-purple/25 text-studio-text ring-1 ring-studio-purple/30'
                  : 'text-studio-text-dim hover:bg-white/[0.06] hover:text-studio-text'}"
                style={`padding-left:${8 + entry.depth * 12}px`}
                onclick={() => void openEntry(entry)}
                ondblclick={() => void pinEntry(entry)}
                oncontextmenu={(e) => openCtx(e, entry)}
                title={entry.kind === 'f' ? 'Click preview · double-click pin · right-click menu' : 'Right-click for actions'}
              >
                <span class="grid w-3 place-items-center text-studio-text-dim">
                  {#if entry.kind === 'd'}
                    <Icon name={expanded[entry.path] ? 'chevron-down' : 'chevron-right'} size={10} />
                  {/if}
                </span>
                <Icon name={entry.kind === 'd' ? 'folder' : 'file'} size={12} class="shrink-0" />
                <span class="min-w-0 truncate">{entry.name}</span>
                {#if loadingDirs[entry.path]}<span class="ml-auto text-studio-text-dim">···</span>{/if}
              </button>
            {/if}
            {#if creating && createParent === entry.path && entry.kind === 'd'}
              <form
                class="mb-1 flex items-center gap-1.5 py-0.5 pr-2"
                style={`padding-left:${8 + (entry.depth + 1) * 12}px`}
                onsubmit={(event) => { event.preventDefault(); void submitCreate() }}
              >
                <Icon name={creating === 'file' ? 'file' : 'folder'} size={12} class="shrink-0 text-studio-text-dim" />
                <input
                  class="min-w-0 flex-1 rounded border border-studio-purple/50 bg-studio-dark px-1.5 py-0.5 text-xs text-studio-text outline-none"
                  bind:this={createInput}
                  bind:value={createName}
                  placeholder={creating === 'file' ? 'path/to/file.ts' : 'folder or nested/path'}
                  onblur={() => { if (!createName.trim()) { creating = null; createName = '' } }}
                  onkeydown={(event) => { if (event.key === 'Escape') { creating = null; createName = '' } }}
                />
              </form>
            {/if}
          {/each}
        {/if}
      </aside>
      <section class="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
        {#if error}
          <div class="grid flex-1 place-items-center p-6 text-center text-sm text-danger">{error}</div>
        {:else if selectedPath}
          <div class="flex min-h-10 items-stretch overflow-x-auto border-b border-border-subtle bg-studio-panel/95" role="tablist" aria-label="Open files">
            {#each tabs as tab (tab.path)}
              <div
                class="flex max-w-[240px] items-center border-r border-white/5 {tab.path === selectedPath
                  ? 'bg-studio-purple/20 border-b-2 border-b-studio-purple'
                  : ''}"
              >
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-1.5 px-2 py-2.5 pl-3 text-left font-mono text-[12px] {tab.path === selectedPath
                    ? 'text-studio-text'
                    : 'text-studio-text-dim hover:text-studio-text'} {tab.preview ? 'italic opacity-80' : ''}"
                  role="tab"
                  aria-selected={tab.path === selectedPath}
                  title={tab.preview ? 'Preview · double-click to pin' : tab.path}
                  onclick={() => void activateTab(tab)}
                  ondblclick={() => {
                    if (tab.preview) {
                      tab.preview = false
                      tabs = [...tabs]
                    }
                  }}
                >
                  {#if tab.content !== tab.originalContent}
                    <span class="text-[10px] text-studio-gold" aria-label="Unsaved changes">●</span>
                  {/if}
                  <span class="truncate">{tab.path.split('/').at(-1)}</span>
                </button>
                <button
                  type="button"
                  class="mr-1.5 grid size-7 place-items-center rounded-md text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
                  aria-label={`Close ${tab.path}`}
                  onclick={() => requestCloseTab(tab.path)}><Icon name="close" size={12} /></button
                >
              </div>
            {/each}
            <button
              type="button"
              class="ml-auto flex items-center gap-1.5 px-3 text-[12px] text-studio-text-dim hover:text-studio-text disabled:opacity-45 {diagnosticErrors > 0
                ? 'text-danger'
                : diagnosticWarnings > 0
                  ? 'text-studio-gold'
                  : ''}"
              disabled={diagnosticsBusy}
              title={dirty ? 'Showing saved-file diagnostics; save to refresh' : 'Open Problems'}
              onclick={() => {
                diagnosticsOpen = !diagnosticsOpen
                if (diagnosticsOpen && !diagnosticsLoaded && !dirty) void runDiagnostics()
              }}
            >
              <span>Problems</span>
              {#if diagnosticErrors > 0}
                <span class="rounded-lg bg-danger-bg px-1.5 text-[10px] text-danger">{diagnosticErrors}</span>
              {:else if diagnosticWarnings > 0}
                <span class="rounded-lg bg-studio-gold/15 px-1.5 text-[10px] text-studio-gold">{diagnosticWarnings}</span>
              {/if}
              {#if diagnosticsBusy}<span>···</span>{/if}
            </button>
          </div>
          {#if dirty || formatting}
            <div class="flex items-center justify-end gap-2 border-b border-border-subtle bg-studio-sidebar/40 px-3 py-1 text-[11px] text-studio-text-dim">
              {#if dirty}<span class="text-studio-gold">{t('code.edited')}</span>{/if}
              {#if formatting}<span>Formatting…</span>{/if}
            </div>
          {/if}
          <div class="min-h-0 flex-1 overflow-hidden" bind:this={editorHost}></div>
          {#if diagnosticsOpen}
            <section class="max-h-48 border-t border-border-subtle bg-studio-panel">
              <header class="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-[11px]">
                <strong class="text-studio-text">Problems</strong>
                <span class="text-studio-text-dim">{diagnostics.length}</span>
                <button type="button" class="ml-auto text-studio-text-dim hover:text-studio-text disabled:opacity-45" disabled={diagnosticsBusy} onclick={() => void runDiagnostics()}>Refresh</button>
                <button type="button" class="text-studio-text-dim hover:text-studio-text" aria-label="Close problems" onclick={() => (diagnosticsOpen = false)}>×</button>
              </header>
              <div class="max-h-36 overflow-auto p-4">
                {#if dirty}
                  <div class="pb-2 text-[10px] text-studio-gold">{t('code.unsavedBadge')}</div>
                {/if}
                {#if diagnosticsLoaded && diagnostics.length === 0}
                  <div class="py-4 text-center text-xs text-studio-text-dim">No problems found.</div>
                {:else if !diagnosticsLoaded}
                  <div class="py-4 text-center text-xs text-studio-text-dim">Save file or click Refresh to run diagnostics.</div>
                {/if}
                {#each diagnostics as problem, index (`${problem.path}:${problem.line}:${problem.column}:${index}`)}
                  <button
                    type="button"
                    class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5"
                    onclick={() => void openDiagnostic(problem)}
                  >
                    <span class="mt-0.5 text-xs {problem.severity === 'error' ? 'text-danger' : 'text-studio-gold'}">{problem.severity === 'error' ? '×' : '!'}</span>
                    <span class="min-w-0">
                      <strong class="block text-xs text-studio-text">{problem.message}</strong>
                      <small class="text-[10px] text-studio-text-dim"
                        >{problem.path}:{problem.line}:{problem.column} · {problem.source}{#if problem.code} · {problem.code}{/if}</small
                      >
                    </span>
                  </button>
                {/each}
              </div>
            </section>
          {/if}
        {:else}
          <div class="grid flex-1 place-items-center text-center text-studio-text-dim">
            <div>
              <div class="mb-1.5 font-semibold text-white">Select a file</div>
              <div class="text-xs">Expand folders in the sidebar. Root stays visible.</div>
            </div>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  /* CodeMirror needs height chain on host */
  :global(.cm-editor) {
    height: 100%;
  }
  :global(.cm-scroller) {
    overflow: auto;
  }
</style>

<ConfirmDialog
  open={pendingClosePath != null}
  title={t('code.unsavedTitle')}
  message={pendingClosePath ? t('code.unsavedMessage', { path: pendingClosePath }) : ''}
  cancelLabel={t('code.cancel')}
  confirmLabel={t('code.closeNoSave')}
  danger
  onCancel={() => resolveClose(false)}
  onConfirm={() => resolveClose(true)}
/>

<ConfirmDialog
  open={pendingDeletePath != null}
  title="Delete"
  message={pendingDeletePath ? `Delete “${pendingDeletePath}”? This cannot be undone.` : ''}
  cancelLabel={t('code.cancel')}
  confirmLabel="Delete"
  danger
  onCancel={() => (pendingDeletePath = null)}
  onConfirm={() => void confirmDelete()}
/>

{#if ctxMenu}
  {@const entry = ctxMenu.entry}
  <div
    class="fixed z-[90] min-w-[11.5rem] overflow-hidden rounded-lg border border-border-subtle bg-studio-card py-1 shadow-xl"
    style="left:{ctxMenu.x}px;top:{ctxMenu.y}px"
    role="menu"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    {#if entry.kind === 'd'}
      <button type="button" role="menuitem" class="flex w-full px-3 py-1.5 text-left text-[12px] text-studio-text hover:bg-white/8" onclick={() => beginCreate('file', entry.path)}>New file</button>
      <button type="button" role="menuitem" class="flex w-full px-3 py-1.5 text-left text-[12px] text-studio-text hover:bg-white/8" onclick={() => beginCreate('directory', entry.path)}>New folder</button>
      <div class="my-1 border-t border-border-subtle"></div>
    {/if}
    {#if entry.path !== '.'}
      <button type="button" role="menuitem" class="flex w-full px-3 py-1.5 text-left text-[12px] text-studio-text hover:bg-white/8" onclick={() => beginRename(entry as Entry)}>Rename</button>
      <button type="button" role="menuitem" class="flex w-full px-3 py-1.5 text-left text-[12px] text-danger hover:bg-danger-bg" onclick={() => requestDelete(entry as Entry)}>Delete</button>
      <div class="my-1 border-t border-border-subtle"></div>
    {/if}
    <button type="button" role="menuitem" class="flex w-full px-3 py-1.5 text-left text-[12px] text-studio-text hover:bg-white/8" onclick={() => void copyPath(entry, false)}>Copy path</button>
    <button type="button" role="menuitem" class="flex w-full px-3 py-1.5 text-left text-[12px] text-studio-text hover:bg-white/8" onclick={() => void copyPath(entry, true)}>Copy relative path</button>
  </div>
{/if}
