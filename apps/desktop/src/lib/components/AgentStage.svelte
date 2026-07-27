<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { state as app, COMPOSER_MODES, type ChatMessage, type ComposerAttachment, type ComposerMode, type PermissionMode } from '../store.svelte'
  import { acceptAgentCheckpoint, compactSession, exportSessionMarkdown, getAgentCheckpoints, newSession, openSession, readProjectFile, refreshSessionList, respondAllApprovals, respondApproval, respondAsk, rollbackAgentCheckpoint, saveProviderConfig, searchProjectFiles, sendPrompt, stopAgentTurn, undoCompactSession } from '../enpii'
  import { renderMarkdown } from '../markdown'
  import SmartSelect from './ui/SmartSelect.svelte'
  import ConfirmDialog from './ui/ConfirmDialog.svelte'

  type AgentPane = 'enpii' | string
  const VENDOR_CLIS = [
    { id: 'claude', label: 'Claude', command: 'claude', args: [] as string[] },
    { id: 'codex', label: 'Codex', command: 'codex', args: [] as string[] },
    { id: 'aider', label: 'Aider', command: 'aider', args: [] as string[] },
    { id: 'gemini', label: 'Gemini', command: 'gemini', args: [] as string[] },
  ] as const

  let agentPane = $state<AgentPane>('enpii')
  let vendorHost = $state<HTMLDivElement>()
  let vendorError = $state('')
  let vendorBusy = $state(false)
  /** Open vendor tabs (order preserved). Default none — enpii only. */
  let vendorTabs = $state<string[]>([])
  let vendorMenuOpen = $state(false)
  let vendorMenuEl = $state<HTMLDivElement>()
  const vendorTerms = new Map<string, { ptyId: string; term: Terminal; fit: FitAddon; size: { cols: number; rows: number } }>()
  const vendorPending = new Map<string, string>()
  let vendorResizeTimer: ReturnType<typeof setTimeout> | undefined
  let vendorResizeObs: ResizeObserver | undefined
  let vendorDestroyed = false
  let vendorProjectId: string | null = null
  const termApi = typeof window !== 'undefined' ? window.enpiistudio?.terminal : undefined

  const vendorAvailable = $derived(VENDOR_CLIS.filter((c) => !vendorTabs.includes(c.id)))

  function measureVendorHost(): { cols: number; rows: number } {
    const cellW = 7.2
    const cellH = 15
    const cols = Math.max(40, Math.floor((vendorHost?.clientWidth || 800) / cellW))
    const rows = Math.max(12, Math.floor((vendorHost?.clientHeight || 400) / cellH))
    return { cols, rows }
  }

  function fitVendor(immediate = false): void {
    if (agentPane === 'enpii') return
    const entry = vendorTerms.get(agentPane)
    if (!entry || !vendorHost || vendorHost.clientWidth <= 0) return
    const apply = () => {
      try {
        entry.fit.fit()
        if (entry.size.cols === entry.term.cols && entry.size.rows === entry.term.rows) return
        entry.size = { cols: entry.term.cols, rows: entry.term.rows }
        void termApi?.resize(entry.ptyId, entry.term.cols, entry.term.rows)
      } catch {
        /* not mounted */
      }
    }
    if (immediate) {
      if (vendorResizeTimer) clearTimeout(vendorResizeTimer)
      vendorResizeTimer = undefined
      apply()
      return
    }
    if (vendorResizeTimer) clearTimeout(vendorResizeTimer)
    vendorResizeTimer = setTimeout(() => {
      vendorResizeTimer = undefined
      apply()
    }, 80)
  }

  async function mountVendorTerm(cliId: string): Promise<void> {
    if (!vendorHost) return
    const entry = vendorTerms.get(cliId)
    if (!entry) return
    if (!entry.term.element) entry.term.open(vendorHost)
    else if (vendorHost.firstElementChild !== entry.term.element) vendorHost.replaceChildren(entry.term.element)
    fitVendor(true)
    entry.term.focus()
  }

  async function ensureVendor(cliId: string): Promise<void> {
    if (!app.activeProject || !termApi) return
    if (vendorTerms.has(cliId)) {
      await tick()
      await mountVendorTerm(cliId)
      return
    }
    const cli = VENDOR_CLIS.find((c) => c.id === cliId)
    if (!cli) return
    vendorBusy = true
    vendorError = ''
    try {
      await tick()
      const seed = measureVendorHost()
      const created = await termApi.create(app.activeProject.path, seed.cols, seed.rows, {
        command: cli.command,
        args: cli.args,
        injectProvider: true,
      })
      if (vendorDestroyed) {
        await termApi.kill(created.id)
        return
      }
      const term = new Terminal({
        cols: seed.cols,
        rows: seed.rows,
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 12,
        lineHeight: 1.25,
        scrollback: 5_000,
        drawBoldTextInBrightColors: false,
        theme: {
          background: '#090909',
          foreground: '#d9d9dc',
          cursor: '#e6af2e',
          cursorAccent: '#090909',
          selectionBackground: '#384f8f99',
          black: '#171717',
          red: '#ff6b81',
          green: '#8bd49c',
          yellow: '#e6af2e',
          blue: '#82aaff',
          magenta: '#c792ea',
          cyan: '#67d4d0',
          white: '#d9d9dc',
          brightBlack: '#737884',
          brightWhite: '#ffffff',
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.onData((data) => void termApi.write(created.id, data))
      const buffered = vendorPending.get(created.id)
      if (buffered) {
        term.write(buffered)
        vendorPending.delete(created.id)
      }
      vendorTerms.set(cliId, {
        ptyId: created.id,
        term,
        fit,
        size: { cols: seed.cols, rows: seed.rows },
      })
      await mountVendorTerm(cliId)
    } catch (err) {
      vendorError = err instanceof Error ? err.message : String(err)
    } finally {
      vendorBusy = false
    }
  }

  async function selectAgentPane(pane: AgentPane): Promise<void> {
    agentPane = pane
    vendorMenuOpen = false
    if (pane === 'enpii') {
      vendorHost?.replaceChildren()
      void tick().then(focusComposer)
      return
    }
    await ensureVendor(pane)
  }

  async function addVendorTab(cliId: string): Promise<void> {
    vendorMenuOpen = false
    if (!vendorTabs.includes(cliId)) vendorTabs = [...vendorTabs, cliId]
    await selectAgentPane(cliId)
  }

  async function closeVendor(cliId: string): Promise<void> {
    const entry = vendorTerms.get(cliId)
    if (entry) {
      await termApi?.kill(entry.ptyId)
      entry.term.dispose()
      vendorTerms.delete(cliId)
    }
    vendorTabs = vendorTabs.filter((id) => id !== cliId)
    if (agentPane === cliId) {
      agentPane = 'enpii'
      vendorHost?.replaceChildren()
      void tick().then(focusComposer)
    }
  }

  function onVendorMenuOutside(e: PointerEvent): void {
    if (!vendorMenuOpen) return
    const t = e.target
    if (!(t instanceof Node)) return
    if (vendorMenuEl?.contains(t)) return
    vendorMenuOpen = false
  }

  function onVendorMenuKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && vendorMenuOpen) {
      e.stopPropagation()
      vendorMenuOpen = false
    }
  }

  onMount(() => {
    if (!termApi) return
    const offData = termApi.onData(({ id, data }) => {
      for (const entry of vendorTerms.values()) {
        if (entry.ptyId === id) {
          entry.term.write(data)
          return
        }
      }
      vendorPending.set(id, `${vendorPending.get(id) ?? ''}${data}`)
    })
    const offExit = termApi.onExit(({ id, exitCode }) => {
      for (const [cliId, entry] of vendorTerms) {
        if (entry.ptyId !== id) continue
        entry.term.write(`\r\n\x1b[90m[process exited ${exitCode}]\x1b[0m\r\n`)
        // Keep tab; user re-open via close+click or relaunch.
        void cliId
        return
      }
    })
    vendorResizeObs = new ResizeObserver(() => fitVendor(false))
    if (vendorHost) vendorResizeObs.observe(vendorHost)
    return () => {
      offData()
      offExit()
      vendorResizeObs?.disconnect()
    }
  })

  $effect(() => {
    const host = vendorHost
    if (!host || !vendorResizeObs) return
    vendorResizeObs.observe(host)
    return () => vendorResizeObs?.unobserve(host)
  })

  // Drop vendor PTYs when project changes (not on every render).
  $effect(() => {
    const projectId = app.activeProject?.id ?? null
    if (projectId === vendorProjectId) return
    vendorProjectId = projectId
    for (const entry of vendorTerms.values()) {
      void termApi?.kill(entry.ptyId)
      entry.term.dispose()
    }
    vendorTerms.clear()
    vendorTabs = []
    vendorMenuOpen = false
    agentPane = 'enpii'
    vendorError = ''
    vendorHost?.replaceChildren()
  })

  onDestroy(() => {
    vendorDestroyed = true
    if (vendorResizeTimer) clearTimeout(vendorResizeTimer)
    for (const entry of vendorTerms.values()) {
      void termApi?.kill(entry.ptyId)
      entry.term.dispose()
    }
    vendorTerms.clear()
  })

  type TurnGroup =
    | { kind: 'user'; m: ChatMessage }
    | { kind: 'system'; m: ChatMessage }
    | { kind: 'turn'; items: ChatMessage[] }

  function groupMessages(messages: ChatMessage[]): TurnGroup[] {
    const out: TurnGroup[] = []
    let i = 0
    while (i < messages.length) {
      const m = messages[i]!
      if (m.role === 'user') {
        out.push({ kind: 'user', m })
        i++
        continue
      }
      if (m.role === 'system') {
        out.push({ kind: 'system', m })
        i++
        continue
      }
      const items: ChatMessage[] = []
      while (i < messages.length) {
        const cur = messages[i]!
        if (cur.role === 'user' || cur.role === 'system') break
        items.push(cur)
        i++
      }
      if (items.length) out.push({ kind: 'turn', items })
    }
    return out
  }

  const groups = $derived(groupMessages(app.messages))

  /** Path / short label for tool row (mock: path after tool:name). */
  function toolLabel(m: ChatMessage): string {
    const s = m.tool?.summary ?? m.tool?.args ?? ''
    // "edit_file path=README.md …" / "write_file README.md (created…)"
    const pathEq = s.match(/\bpath=([^\s]+)/)
    if (pathEq) return pathEq[1]!.replace(/^["']|["']$/g, '')
    const named = s.match(
      /^(?:list_dir|read_file|glob|grep|write_file|edit_file)\s+(\S+)/,
    )
    if (named) return named[1]!.replace(/^["']|["']$/g, '')
    return s.slice(0, 48)
  }

  function statusLabel(m: ChatMessage, awaiting: boolean): string {
    if (awaiting) return 'Pending'
    if (m.tool?.status === 'running') return 'Running'
    if (m.tool?.status === 'error') return 'Failed'
    if (m.tool?.status === 'ok') return 'Completed'
    return m.tool?.status ?? ''
  }

  function approvalPath(a: { name: string; summary: string }): string {
    const s = a.summary ?? ''
    if (a.name === 'run_shell') {
      const m = s.match(/^run_shell\s+(.+)$/)
      return m?.[1] ?? 'command'
    }
    if (a.name === 'mcp_call_tool') {
      const m = s.match(/mcp[_\s]+(\S+)/i) || s.match(/(\S+\/\S+)/)
      return m?.[1] ?? 'mcp tool'
    }
    if (a.name.startsWith('git_')) return s.replace(/^git_\w+\s*/, '') || 'repository'
    const m = s.match(/(?:write_file|edit_file|replace_file)\s+(\S+)/)
    return m?.[1] ?? 'file'
  }

  function approvalVerb(name: string): string {
    if (name === 'run_shell') return 'run'
    if (name === 'mcp_call_tool') return 'call MCP'
    if (name === 'git_stage') return 'stage'
    if (name === 'git_unstage') return 'unstage'
    if (name === 'git_commit') return 'commit'
    if (name === 'git_branch') return 'change branch'
    if (name === 'git_stash') return 'manage stash'
    if (name === 'git_fetch') return 'fetch'
    if (name === 'git_pull') return 'pull'
    if (name === 'git_push') return 'push'
    if (name === 'git_resolve_conflict') return 'resolve conflict'
    return name === 'write_file' ? 'write' : 'edit'
  }

  function approvalKind(name: string): string {
    if (name === 'run_shell') return 'Shell Permission'
    if (name === 'mcp_call_tool') return 'MCP Permission'
    if (name.startsWith('git_')) return 'Git Permission'
    return 'Write Permission'
  }

  function approvalButton(name: string): string {
    if (name === 'run_shell') return 'Allow Shell'
    if (name === 'mcp_call_tool') return 'Allow MCP'
    if (name.startsWith('git_')) return 'Allow Git'
    return 'Allow Edit'
  }

  function isTerminalTool(name: string): boolean {
    return name === 'run_shell' || name === 'mcp_call_tool'
  }

  function shellCommand(m: ChatMessage): string {
    const s = m.tool?.summary ?? m.tool?.args ?? ''
    const fromSummary = s.match(/^run_shell\s+(.+)$/)
    if (fromSummary) return fromSummary[1]!
    try {
      const o = JSON.parse(m.tool?.args || '{}') as { command?: string; server?: string; tool?: string }
      if (o.command) return o.command
      if (o.server && o.tool) return `mcp ${o.server}/${o.tool}`
    } catch {
      /* ignore */
    }
    return toolLabel(m)
  }

  async function copyToolOutput(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }

  function pendingForTool(callId: string) {
    return app.pendingApprovals.find(
      (a) => a.toolCallId === callId || a.requestId === callId,
    ) ?? null
  }

  function pendingAskForTool(callId: string) {
    return app.pendingAsks.find(
      (a) => a.toolCallId === callId || a.requestId === callId,
    ) ?? null
  }

  let askDrafts = $state<Record<string, string>>({})

  function askDraft(requestId: string): string {
    return askDrafts[requestId] ?? ''
  }

  function setAskDraft(requestId: string, value: string): void {
    askDrafts = { ...askDrafts, [requestId]: value }
  }

  function submitAsk(requestId: string, answer?: string): void {
    const text = (answer ?? askDraft(requestId)).trim()
    if (!text) return
    const next = { ...askDrafts }
    delete next[requestId]
    askDrafts = next
    void respondAsk(text, requestId)
  }

  function diffLineClass(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'diff-meta'
    if (line.startsWith('@@')) return 'diff-hunk'
    if (line.startsWith('+')) return 'diff-add'
    if (line.startsWith('-')) return 'diff-del'
    return 'diff-ctx'
  }

  function isUnifiedDiff(text: string): boolean {
    return text.startsWith('--- ') || text.includes('\n+++ ') || text.startsWith('+++ ')
  }

  let stageEl: HTMLDivElement | undefined
  let composerEl: HTMLTextAreaElement | undefined
  let stickBottom = $state(true)
  let checkpointBusy = $state(false)
  let slashActive = $state(0)
  let attachmentPreviewId = $state<string | null>(null)
  let draggingFiles = $state(false)
  let dragDepth = 0
  let mentionActive = $state(0)
  let mentionResults = $state<string[]>([])
  let mentionLoading = $state(false)
  let mentionCaret = $state(0)
  let mentionTimer: ReturnType<typeof setTimeout> | undefined
  let mentionSeq = 0

  /** Active `@query` token at caret (not email-like mid-word). */
  function mentionContext(text: string, caret = text.length): { start: number; query: string } | null {
    const before = text.slice(0, caret)
    const match = before.match(/(^|[\s([{])@([^\s@]*)$/)
    if (!match || match.index === undefined) return null
    return { start: match.index + match[1]!.length, query: match[2] ?? '' }
  }

  const activeMention = $derived(mentionContext(app.composer, mentionCaret))

  function syncMentionCaret(): void {
    mentionCaret = composerEl?.selectionStart ?? app.composer.length
  }

  $effect(() => {
    const m = activeMention
    if (!m || !app.activeProject) {
      mentionResults = []
      mentionLoading = false
      if (mentionTimer) clearTimeout(mentionTimer)
      return
    }
    const query = m.query
    if (mentionTimer) clearTimeout(mentionTimer)
    mentionTimer = setTimeout(() => void runMentionSearch(query), 140)
  })

  async function runMentionSearch(query: string): Promise<void> {
    const project = app.activeProject
    if (!project) return
    const seq = ++mentionSeq
    mentionLoading = true
    try {
      const hits: string[] = []
      if (app.codeSelection?.path) {
        const q = query.toLowerCase()
        if (!q || 'selection'.startsWith(q) || app.codeSelection.path.toLowerCase().includes(q)) {
          hits.push('__selection__')
        }
      }
      if (query.trim()) {
        const result = await searchProjectFiles(project.path, query)
        if (seq !== mentionSeq) return
        const files = result.content && result.content !== '(no matches)'
          ? result.content.split('\n').map((line) => line.trim()).filter(Boolean)
          : []
        hits.push(...files.slice(0, 12))
      } else if (app.codePath) {
        hits.push(app.codePath)
      }
      mentionResults = hits.slice(0, 14)
      mentionActive = 0
    } catch {
      if (seq === mentionSeq) mentionResults = app.codeSelection ? ['__selection__'] : []
    } finally {
      if (seq === mentionSeq) mentionLoading = false
    }
  }

  function mentionLabel(path: string): string {
    if (path === '__selection__' && app.codeSelection) {
      return `@selection ${app.codeSelection.path}:${app.codeSelection.startLine}-${app.codeSelection.endLine}`
    }
    return path
  }

  function applyMention(path: string): void {
    const m = mentionContext(app.composer, mentionCaret)
    if (!m) return
    const insert = path === '__selection__' ? '@selection' : `@${path}`
    app.composer = `${app.composer.slice(0, m.start)}${insert} ${app.composer.slice(mentionCaret)}`
    mentionResults = []
    void tick().then(() => {
      if (!composerEl) return
      const pos = m.start + insert.length + 1
      composerEl.focus()
      composerEl.setSelectionRange(pos, pos)
      mentionCaret = pos
    })
  }

  function tagOf(name: string): string {
    return `[${name}]`
  }

  /** Intact `[name.ext]` ranges in text (atomic units). */
  function tagRanges(text: string): { start: number; end: number; name: string }[] {
    const out: { start: number; end: number; name: string }[] = []
    const re = /\[([^\[\]\n]+)\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      out.push({ start: m.index, end: m.index + m[0].length, name: m[1]! })
    }
    return out
  }

  function setComposer(next: string, caret: number): void {
    app.composer = next
    if (composerEl) {
      composerEl.value = next
      const pos = Math.max(0, Math.min(caret, next.length))
      composerEl.focus()
      composerEl.setSelectionRange(pos, pos)
      mentionCaret = pos
    }
  }

  function insertFileTags(names: string[]): void {
    const el = composerEl
    const cur = el?.value ?? app.composer
    const tags = names.map(tagOf).filter((tag) => !cur.includes(tag))
    if (!tags.length) return
    const start = el?.selectionStart ?? cur.length
    const end = el?.selectionEnd ?? start
    const before = cur.slice(0, start)
    const after = cur.slice(end)
    const padL = before && !/\s$/.test(before) ? ' ' : ''
    const padR = after && !/^\s/.test(after) ? ' ' : ''
    const insert = `${padL}${tags.join(' ')}${padR}`
    setComposer(`${before}${insert}${after}`, before.length + insert.length)
  }

  function sameFile(a: ComposerAttachment, b: { name: string; path?: string }): boolean {
    if (a.path && b.path) return a.path === b.path
    return a.name === b.name
  }

  function addAttachments(picked: Omit<ComposerAttachment, 'id'>[]): void {
    const rejected = picked.filter((file) => file.error)
    const namesToTag: string[] = []
    let next = [...app.attachments]
    for (const file of picked) {
      if (file.error) continue
      const idx = next.findIndex((a) => sameFile(a, file))
      if (idx >= 0) {
        // Same path/name → refresh body only, never invent a prefix name.
        const prev = next[idx]!
        next[idx] = { ...file, id: prev.id, name: prev.name, path: file.path ?? prev.path }
        namesToTag.push(prev.name)
        continue
      }
      // Same basename, different path → still one display name (no auto prefix).
      const byName = next.findIndex((a) => a.name === file.name)
      if (byName >= 0) {
        const prev = next[byName]!
        next[byName] = { ...file, id: prev.id, name: prev.name, path: file.path ?? prev.path }
        namesToTag.push(prev.name)
        continue
      }
      if (next.length >= 8) {
        app.notify('warning', 'Attachment limit', 'Maksimum 8 file.')
        break
      }
      next.push({ ...file, id: crypto.randomUUID() })
      namesToTag.push(file.name)
    }
    app.attachments = next
    if (namesToTag.length) insertFileTags([...new Set(namesToTag)])
    if (rejected.length) {
      const first = rejected[0]!
      app.notify(
        'warning',
        'Attachment ditolak',
        rejected.length === 1
          ? `${first.name}: ${first.error}`
          : `${rejected.length} file ditolak. Contoh: ${first.name}: ${first.error}`,
      )
    }
  }

  async function attachFiles(): Promise<void> {
    try {
      addAttachments(await window.enpiistudio.dialog.openFiles())
    } catch (err) {
      app.notify('error', 'Attachment failed', err instanceof Error ? err.message : String(err))
    }
  }

  async function addAttachmentsFromPaths(paths: string[]): Promise<void> {
    if (!paths.length) return
    try {
      addAttachments(await window.enpiistudio.dialog.parseFiles(paths))
      void tick().then(focusComposer)
    } catch (err) {
      app.notify('error', 'Attachment failed', err instanceof Error ? err.message : String(err))
    }
  }

  async function addFileObjects(files: File[]): Promise<void> {
    const paths = files
      .map((file) => {
        try {
          return window.enpiistudio.dialog.pathForFile(file)
        } catch {
          return ''
        }
      })
      .filter(Boolean) as string[]
    await addAttachmentsFromPaths(paths)
  }

  function onDragEnter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    dragDepth += 1
    draggingFiles = true
  }

  function onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) draggingFiles = false
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    dragDepth = 0
    draggingFiles = false
    void addFileObjects(Array.from(event.dataTransfer?.files ?? []))
  }

  function fileUriToPath(uri: string): string | null {
    try {
      if (!uri.startsWith('file:')) return null
      const parsed = new URL(uri)
      let p = decodeURIComponent(parsed.pathname)
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
      return p
    } catch {
      return null
    }
  }

  function cleanPathToken(token: string): string {
    return token.trim().replace(/^['"`]+|['"`]+$/g, '').replace(/[,;]+$/g, '')
  }

  function looksLikeAbsPath(token: string): boolean {
    const t = cleanPathToken(token)
    if (!t || /\s/.test(t)) return false
    if (t.startsWith('file:')) return Boolean(fileUriToPath(t))
    if (!(t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('\\\\'))) return false
    if (/\.[A-Za-z0-9]{1,16}$/.test(t)) return true
    const base = t.split(/[\\/]/).pop() ?? ''
    return /^(README|LICENSE|CHANGELOG|Makefile|Dockerfile|Gemfile|Procfile)(\..+)?$/i.test(base)
  }

  function normalizePathToken(token: string): string | null {
    const t = cleanPathToken(token)
    if (!t) return null
    if (t.startsWith('file:')) return fileUriToPath(t)
    return looksLikeAbsPath(t) ? t : null
  }

  function clipboardPaths(data: DataTransfer | null): string[] {
    if (!data) return []
    const paths: string[] = []

    for (const file of Array.from(data.files ?? [])) {
      try {
        const p = window.enpiistudio.dialog.pathForFile(file)
        if (p) paths.push(p)
      } catch {
        /* skip */
      }
    }

    let uriList = ''
    let plain = ''
    try {
      uriList = data.getData('text/uri-list') || ''
    } catch {
      /* skip */
    }
    try {
      plain = data.getData('text/plain') || ''
    } catch {
      /* skip */
    }

    for (const line of `${uriList}\n${plain}`.split(/\r?\n/)) {
      const token = line.trim()
      if (!token || token.startsWith('#')) continue
      const direct = normalizePathToken(token)
      if (direct) {
        paths.push(direct)
        continue
      }
      const match = token.match(/(file:\/\/\S+|\/\S+|[A-Za-z]:[\\/]\S+|\\\\\S+)/)
      if (match) {
        const n = normalizePathToken(match[1]!)
        if (n) paths.push(n)
      }
    }

    return [...new Set(paths)].slice(0, 8)
  }

  /** Only intercept path/file pastes. Plain text always goes through. */
  function onPaste(event: ClipboardEvent): void {
    const target = event.target as Node | null
    if (composerEl && target && target !== composerEl && !composerEl.contains(target)) return

    const paths = clipboardPaths(event.clipboardData)
    if (!paths.length) return
    event.preventDefault()
    event.stopPropagation()
    void addAttachmentsFromPaths(paths)
  }

  /** Drop attachments whose exact `[name]` tag is gone; scrub half-edited tags. */
  function syncAttachmentsFromComposer(): void {
    const text = composerEl?.value ?? app.composer
    const intact = new Set(tagRanges(text).map((t) => t.name))
    const kept = app.attachments.filter((file) => intact.has(file.name))
    if (kept.length === app.attachments.length) return
    app.attachments = kept
    if (attachmentPreviewId && !kept.some((f) => f.id === attachmentPreviewId)) {
      attachmentPreviewId = null
    }
  }

  /** If caret/selection touches a tag, expand to whole `[name]`. */
  function expandSelectionOverTag(start: number, end: number, text: string): { start: number; end: number } | null {
    for (const tag of tagRanges(text)) {
      const touches =
        (start > tag.start && start < tag.end) ||
        (end > tag.start && end < tag.end) ||
        (start <= tag.start && end >= tag.end && end - start > 0 && start < tag.end && end > tag.start)
      const caretInside = start === end && start > tag.start && start < tag.end
      const caretOnEdgeDelete =
        start === end && (start === tag.start || start === tag.end)
      if (touches || caretInside) return { start: tag.start, end: tag.end }
      // Backspace just after tag / Delete just before tag handled by caller with direction.
      void caretOnEdgeDelete
    }
    return null
  }

  function tagAtBackspace(caret: number, text: string): { start: number; end: number } | null {
    if (caret <= 0) return null
    for (const tag of tagRanges(text)) {
      if (caret === tag.end) return tag
      if (caret > tag.start && caret < tag.end) return tag
    }
    return null
  }

  function tagAtDelete(caret: number, text: string): { start: number; end: number } | null {
    for (const tag of tagRanges(text)) {
      if (caret === tag.start) return tag
      if (caret > tag.start && caret < tag.end) return tag
    }
    return null
  }

  function deleteTagRange(tag: { start: number; end: number; name?: string }, text: string): void {
    const name = tag.name ?? text.slice(tag.start + 1, tag.end - 1)
    let next = `${text.slice(0, tag.start)}${text.slice(tag.end)}`
    next = next.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
    // Trim space left at caret if doubled
    const caret = Math.min(tag.start, next.length)
    setComposer(next, caret)
    app.attachments = app.attachments.filter((file) => file.name !== name)
    if (attachmentPreviewId && !app.attachments.some((f) => f.id === attachmentPreviewId)) {
      attachmentPreviewId = null
    }
  }

  function onComposerInput(): void {
    syncMentionCaret()
    syncAttachmentsFromComposer()
  }

  function removeAttachment(id: string): void {
    const gone = app.attachments.find((file) => file.id === id)
    app.attachments = app.attachments.filter((file) => file.id !== id)
    if (attachmentPreviewId === id) attachmentPreviewId = null
    if (gone) {
      const tag = tagOf(gone.name)
      const cur = app.composer
      const idx = cur.indexOf(tag)
      if (idx >= 0) {
        const next = `${cur.slice(0, idx)}${cur.slice(idx + tag.length)}`.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
        setComposer(next, idx)
      }
    }
  }

  function attachmentChips(): { name: string; kind?: 'text' | 'image' }[] {
    return app.attachments
      .filter((file) => !file.error)
      .map((file) => ({ name: file.name, kind: file.kind }))
  }

  /** Ensure display text has `[name]` for each attachment (no dup tags). */
  function withFileTags(text: string): string {
    const tags = attachmentChips().map((file) => `[${file.name}]`)
    if (!tags.length) return text
    const missing = tags.filter((tag) => !text.includes(tag))
    if (!missing.length) return text
    return text ? `${text} ${missing.join(' ')}` : missing.join(' ')
  }

  function attachmentPrompt(text: string): string {
    const usable = app.attachments.filter((file) => (file.content || file.images?.length) && !file.error)
    if (!usable.length) return text
    const context = usable.map((file) => {
      if (file.kind === 'image' || file.images?.length) {
        const names = (file.images ?? [{ name: file.name }]).map((img) => img.name).join(', ')
        return `--- attachment image: ${names} ---\n(see image part; filename for reference only)`
      }
      return `--- attachment: ${file.name} (${file.kind}) ---\n${file.content.slice(0, 120_000)}`
    }).join('\n\n')
    return `${text}\n\nAttached context (preprocessed locally):\n${context}`
  }

  /** Collect unique @path and @selection tokens from composer text. */
  function parseRefs(text: string): { files: string[]; selection: boolean } {
    const files = new Set<string>()
    let selection = false
    for (const match of text.matchAll(/(^|[\s([{])@([^\s@]+)/g)) {
      const token = match[2]!
      if (token === 'selection') selection = true
      else files.add(token.replace(/^["']|["']$/g, ''))
    }
    return { files: [...files].slice(0, 8), selection }
  }

  async function refsPrompt(text: string): Promise<string> {
    const project = app.activeProject
    if (!project) return text
    const { files, selection } = parseRefs(text)
    const blocks: string[] = []
    if (selection && app.codeSelection) {
      const s = app.codeSelection
      blocks.push(`--- selection: ${s.path}:${s.startLine}-${s.endLine} ---\n${s.text}`)
    }
    for (const rel of files) {
      try {
        const result = await readProjectFile(project.path, rel)
        blocks.push(`--- file: ${rel} ---\n${result.content.slice(0, 120_000)}`)
      } catch (err) {
        blocks.push(`--- file: ${rel} ---\n(unavailable: ${err instanceof Error ? err.message : String(err)})`)
      }
    }
    if (!blocks.length) return text
    return `${text}\n\nReferenced context (from @ mentions):\n${blocks.join('\n\n')}`
  }

  function attachmentImages(): { name: string; mime: string; dataUrl: string }[] {
    return app.attachments.flatMap((file) => file.images ?? []).slice(0, 4)
  }

  function attachmentTokens(): number {
    const textTokens = app.attachments.reduce((sum, file) => sum + Math.ceil(file.content.length / 4), 0)
    return textTokens + attachmentImages().length * 1_000
  }

  type SlashCommand = {
    name: string
    usage: string
    description: string
    run: (args: string) => Promise<void> | void
  }

  function addSystem(text: string): void {
    app.pushMessage({ role: 'system', text })
  }

  function resolveComposerMode(value: string): (typeof COMPOSER_MODES)[number] | null {
    const raw = value.trim().toLowerCase()
    const compact = raw.replace(/[-_]/g, '')
    return (
      COMPOSER_MODES.find((m) => m.value === raw) ??
      COMPOSER_MODES.find((m) => m.value.replace(/_/g, '') === compact) ??
      COMPOSER_MODES.find((m) => m.label.toLowerCase().replace(/[-_\s]/g, '') === compact) ??
      null
    )
  }

  async function changeComposerMode(value: string): Promise<void> {
    const selected = resolveComposerMode(value)
    if (!selected) {
      addSystem(`Mode: ${COMPOSER_MODES.map((m) => m.value.replace(/_/g, '-')).join(', ')}.`)
      return
    }
    app.composerMode = selected.value as ComposerMode
    try {
      await saveProviderConfig({ permissionMode: selected.permission as PermissionMode })
      addSystem(`Composer mode: ${selected.value}. Permission: ${selected.permission}.`)
    } catch (err) {
      addSystem(`Mode gagal diubah: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const slashCommands: SlashCommand[] = [
    { name: '/help', usage: '/help', description: 'Tampilkan semua slash command.', run: () => addSystem(slashCommands.map((command) => `${command.usage} — ${command.description}`).join('\n')) },
    { name: '/session', usage: '/session [new|list|ID]', description: 'Buat, lihat, atau buka session project.', run: async (args) => {
      const value = args.trim()
      if (value === 'new') return newSession()
      await refreshSessionList()
      if (value && value !== 'list') {
        const target = app.sessionList.find((session) => session.id === value || session.id.startsWith(value))
        if (target) return openSession(target.id)
      }
      addSystem(app.sessionList.length ? app.sessionList.map((session) => `${session.id.slice(0, 8)}… · ${session.title} · ${session.messageCount ?? 0} messages`).join('\n') : 'Belum ada session tersimpan.')
    } },
    { name: '/compact', usage: '/compact', description: 'Ringkas dan ganti context session agar lebih kecil.', run: async () => { const result = await compactSession(); addSystem(`Context compacted: ${result.originalMessageCount} messages → 1 summary. Undo: /undo-compact`) } },
    { name: '/undo-compact', usage: '/undo-compact', description: 'Pulihkan transcript sebelum compact terakhir (memory only).', run: async () => { const result = await undoCompactSession(); addSystem(`Compact undone · restored ${result.messageCount} messages`) } },
    { name: '/export', usage: '/export', description: 'Export transcript session aktif ke Markdown.', run: async () => { const result = await exportSessionMarkdown(); addSystem(`Exported ${result.messageCount} messages.`) } },
    { name: '/plan', usage: '/plan [tujuan]', description: 'Aktifkan Plan mode; perubahan file tetap diblokir.', run: async (args) => { await changeComposerMode('plan'); if (args.trim()) await sendPrompt(`Buat rencana implementasi untuk: ${args.trim()}. Jangan mengubah file.`) } },
    { name: '/mode', usage: '/mode <manual|accept-edits|plan|full-auto>', description: 'Ubah permission dan mode composer.', run: (args) => changeComposerMode(args) },
    { name: '/review', usage: '/review', description: 'Review perubahan workspace saat ini.', run: () => sendPrompt('Review perubahan workspace saat ini. Jangan mengubah file. Laporkan risiko dan masalah penting.') },
    { name: '/test', usage: '/test', description: 'Deteksi dan jalankan test/check yang relevan.', run: () => sendPrompt('Deteksi lalu jalankan test atau check paling relevan untuk perubahan saat ini.') },
    { name: '/commit', usage: '/commit [pesan]', description: 'Siapkan commit; minta approval sebelum Git write.', run: (args) => sendPrompt(args.trim() ? `Siapkan commit dengan pesan: ${args.trim()}` : 'Review perubahan, stage yang relevan, lalu siapkan commit message. Minta approval sebelum Git write.') },
    { name: '/clear', usage: '/clear', description: 'Bersihkan chat lokal session aktif.', run: () => { app.messages = []; app.resetRun(); app.diffs = [] } },
  ]

  const slashContext = $derived(app.composer.match(/^\/([^\s]*)/))
  const slashSuggestions = $derived(slashContext ? slashCommands.filter((command) => command.name.slice(1).startsWith(slashContext[1]!.toLowerCase())) : [])

  async function executeSlash(): Promise<boolean> {
    const match = app.composer.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
    if (!match) return false
    const command = slashCommands.find((item) => item.name.slice(1) === match[1]!.toLowerCase())
    if (!command) {
      addSystem(`Unknown command: /${match[1]}. Gunakan /help.`)
      app.composer = ''
      return true
    }
    app.composer = ''
    await command.run(match[2] ?? '')
    return true
  }

  async function loadCheckpoints(): Promise<void> {
    if (!app.activeProject) return
    try { app.checkpoints = await getAgentCheckpoints(app.activeProject.path) } catch { app.checkpoints = [] }
  }

  type CheckpointConfirm =
    | { kind: 'rollback'; id: string; path?: string }
    | { kind: 'retry'; id: string; prompt: string }

  let checkpointConfirm = $state<CheckpointConfirm | null>(null)

  function requestRollbackCheckpoint(id: string, path?: string): void {
    if (!app.activeProject) return
    checkpointConfirm = { kind: 'rollback', id, path }
  }

  function requestRetryCheckpoint(id: string, prompt?: string): void {
    if (!app.activeProject || !prompt) return
    checkpointConfirm = { kind: 'retry', id, prompt }
  }

  async function confirmCheckpointAction(): Promise<void> {
    const req = checkpointConfirm
    checkpointConfirm = null
    if (!req || !app.activeProject) return
    checkpointBusy = true
    try {
      if (req.kind === 'rollback') {
        app.checkpoints = await rollbackAgentCheckpoint(app.activeProject.path, req.id, req.path)
      } else {
        await rollbackAgentCheckpoint(app.activeProject.path, req.id)
        app.checkpoints = await acceptAgentCheckpoint(app.activeProject.path, req.id)
        await sendPrompt(req.prompt)
      }
    } catch (err) {
      app.pushMessage({ role: 'system', text: err instanceof Error ? err.message : String(err) })
    } finally {
      checkpointBusy = false
    }
  }

  async function acceptCheckpoint(id: string, path?: string): Promise<void> {
    if (!app.activeProject) return
    checkpointBusy = true
    try { app.checkpoints = await acceptAgentCheckpoint(app.activeProject.path, id, path) }
    catch (err) { app.pushMessage({ role: 'system', text: err instanceof Error ? err.message : String(err) }) }
    finally { checkpointBusy = false }
  }

  function onStageScroll() {
    if (!stageEl) return
    const dist = stageEl.scrollHeight - stageEl.scrollTop - stageEl.clientHeight
    stickBottom = dist < 80
  }

  async function scrollToBottom(force = false) {
    await tick()
    if (!stageEl) return
    if (!force && !stickBottom) return
    stageEl.scrollTop = stageEl.scrollHeight
  }

  function otherTextFieldFocused(): boolean {
    const ae = document.activeElement
    if (!ae || ae === composerEl) return false
    return (
      ae instanceof HTMLInputElement ||
      ae instanceof HTMLTextAreaElement ||
      (ae as HTMLElement).isContentEditable === true
    )
  }

  function focusComposer() {
    if (agentPane !== 'enpii') return
    if (!composerEl || composerEl.disabled) return
    if (!app.activeProject) return
    if (otherTextFieldFocused()) return
    if (document.activeElement === composerEl) return
    composerEl.focus({ preventScroll: true })
  }

  function composerControlFocused(): boolean {
    return Boolean(composerEl?.closest('.composer-inner')?.contains(document.activeElement))
  }

  function onComposerBlur(): void {
    if (agentPane !== 'enpii' || !app.activeProject || app.busy) return
    requestAnimationFrame(() => {
      if (agentPane !== 'enpii') return
      if (composerControlFocused() || document.querySelector('[role="dialog"]')) return
      focusComposer()
    })
  }

  function cycleComposerMode(): void {
    const index = COMPOSER_MODES.findIndex((mode) => mode.value === app.composerMode)
    const next = COMPOSER_MODES[(index + 1) % COMPOSER_MODES.length]!.value
    void changeComposerMode(next)
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (app.mode !== 'agent' || agentPane !== 'enpii' || !app.activeProject || app.busy) return
    if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
      event.preventDefault()
      cycleComposerMode()
    }
  }

  $effect(() => {
    void app.activeProject?.id
    void loadCheckpoints()
  })

  $effect(() => {
    void app.messages.length
    void app.pendingApprovals.length
    void app.pendingAsks.length
    void app.streamingId
    void app.messages[app.messages.length - 1]?.text
    void scrollToBottom()
  })

  // keep composer focused for project/session when idle (enpii pane only)
  $effect(() => {
    void app.activeProject?.id
    void app.session?.id
    void app.busy
    void app.pendingApprovals.length
    void app.pendingAsks.length
    void agentPane
    if (agentPane === 'enpii' && app.activeProject && !app.busy && !app.pendingAsks.length) {
      void tick().then(focusComposer)
    }
  })

  async function onSend() {
    const text = app.composer.trim()
    const chips = attachmentChips()
    if ((!text && !chips.length) || app.busy) return
    if (text.startsWith('/')) {
      try {
        await executeSlash()
      } catch (err) {
        addSystem(err instanceof Error ? err.message : String(err))
      } finally {
        void tick().then(focusComposer)
      }
      return
    }
    if (!app.activeProject) {
      app.pushMessage({ role: 'system', text: 'Open a project first.' })
      return
    }
    mentionResults = []
    const displayText = withFileTags(text)
    app.composer = ''
    stickBottom = true
    void scrollToBottom(true)
    try {
      const withRefs = await refsPrompt(text || displayText)
      const prompt = attachmentPrompt(withRefs)
      await sendPrompt(prompt, {
        displayText,
        images: attachmentImages(),
        attachments: chips.length ? chips : undefined,
      })
      app.attachments = []
      attachmentPreviewId = null
    } catch (err) {
      app.pushMessage({
        role: 'system',
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      void tick().then(focusComposer)
    }
  }

  function lastUserPrompt(): string {
    return [...app.messages].reverse().find((message) => message.role === 'user')?.text ?? ''
  }

  async function retryRun(): Promise<void> {
    const prompt = lastUserPrompt()
    if (!prompt || app.busy) return
    await sendPrompt(prompt)
  }

  async function continueRun(): Promise<void> {
    if (app.busy) return
    await sendPrompt('Continue the previous task from the current workspace state. Inspect existing changes first and do not duplicate completed work.')
  }

  function onKeydown(e: KeyboardEvent) {
    const mentionsOpen = Boolean(activeMention && mentionResults.length > 0)
    if (mentionsOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      mentionActive = e.key === 'ArrowDown'
        ? Math.min(mentionActive + 1, mentionResults.length - 1)
        : Math.max(mentionActive - 1, 0)
      return
    }
    if (mentionsOpen && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault()
      applyMention(mentionResults[mentionActive] ?? mentionResults[0]!)
      return
    }
    if (mentionsOpen && e.key === 'Escape') {
      e.preventDefault()
      mentionResults = []
      return
    }
    if (slashSuggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      slashActive = e.key === 'ArrowDown' ? Math.min(slashActive + 1, slashSuggestions.length - 1) : Math.max(slashActive - 1, 0)
      return
    }
    if (slashSuggestions.length > 0 && e.key === 'Tab') {
      e.preventDefault()
      app.composer = `${slashSuggestions[slashActive]?.name ?? slashSuggestions[0]?.name} `
      return
    }

    // Atomic `[name.ext]` tags: one keystroke removes whole tag + attachment.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) {
      const el = composerEl
      if (el) {
        const text = el.value
        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? start
        if (start !== end) {
          const expanded = expandSelectionOverTag(start, end, text)
          if (expanded && (expanded.start < start || expanded.end > end)) {
            // Selection partially overlaps a tag → expand, then let default delete run next key? force now.
            e.preventDefault()
            const name = text.slice(expanded.start + 1, expanded.end - 1)
            deleteTagRange({ start: expanded.start, end: expanded.end, name }, text)
            return
          }
        } else if (e.key === 'Backspace') {
          const tag = tagAtBackspace(start, text)
          if (tag) {
            e.preventDefault()
            deleteTagRange(tag, text)
            return
          }
        } else if (e.key === 'Delete') {
          const tag = tagAtDelete(start, text)
          if (tag) {
            e.preventDefault()
            deleteTagRange(tag, text)
            return
          }
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void onSend()
    }
  }
</script>

<div
  class="agent-shell"
  class:is-dragging={draggingFiles}
  class:vendor-active={agentPane !== 'enpii'}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  {#if draggingFiles}<div class="composer-drop-overlay agent-drop-overlay">Drop files to attach</div>{/if}
  <div class="agent-model-tabs" role="tablist" aria-label="Agent model">
    <button
      type="button"
      class="agent-model-tab"
      class:active={agentPane === 'enpii'}
      role="tab"
      aria-selected={agentPane === 'enpii'}
      onclick={() => void selectAgentPane('enpii')}
    >enpii</button>
    {#each vendorTabs as tabId (tabId)}
      {@const cli = VENDOR_CLIS.find((c) => c.id === tabId)}
      {#if cli}
        <div class="agent-model-tab-shell" class:active={agentPane === cli.id}>
          <button
            type="button"
            class="agent-model-tab"
            class:active={agentPane === cli.id}
            role="tab"
            aria-selected={agentPane === cli.id}
            title={`${cli.command} · model ${app.provider?.model ?? 'enpii settings'}`}
            onclick={() => void selectAgentPane(cli.id)}
          >{cli.label}</button>
          <button
            type="button"
            class="agent-model-tab-close"
            aria-label={`Close ${cli.label}`}
            title={`Close ${cli.label}`}
            onclick={(e) => {
              e.stopPropagation()
              void closeVendor(cli.id)
            }}
          >×</button>
        </div>
      {/if}
    {/each}
    <div class="agent-model-add-wrap" bind:this={vendorMenuEl}>
      <button
        type="button"
        class="agent-model-add"
        aria-label="Add vendor agent"
        aria-haspopup="menu"
        aria-expanded={vendorMenuOpen}
        title="Add vendor agent"
        disabled={!app.activeProject || vendorAvailable.length === 0}
        onclick={() => (vendorMenuOpen = !vendorMenuOpen)}
      >+</button>
      {#if vendorMenuOpen}
        <div class="agent-model-menu" role="menu">
          {#each vendorAvailable as cli (cli.id)}
            <button
              type="button"
              role="menuitem"
              onclick={() => void addVendorTab(cli.id)}
            >
              {cli.label}
              <code>{cli.command}</code>
            </button>
          {/each}
          <p class="agent-model-menu-hint">
            Model/base URL dari Settings
            {#if app.provider}
              · <code>{app.provider.model}</code>
            {/if}
          </p>
        </div>
      {/if}
    </div>
  </div>
  <div class="agent-vendor-pane" class:visible={agentPane !== 'enpii'}>
    {#if vendorError}<div class="agent-vendor-error">{vendorError}</div>{/if}
    {#if vendorBusy && !vendorTerms.has(agentPane)}<div class="agent-vendor-loading">Starting…</div>{/if}
    <div class="agent-vendor-host terminal-host" bind:this={vendorHost}></div>
  </div>
<div
  class="stage stage-fill custom-scrollbar"
  class:hidden-pane={agentPane !== 'enpii'}
  bind:this={stageEl}
  onscroll={onStageScroll}
>
  {#if !app.activeProject}
    <div class="agent-empty">
      <div class="mark">e</div>
      <div class="enpii">enpii</div>
      <div class="hint">Open a project from the left to start.</div>
    </div>
  {:else if app.messages.length === 0}
    <div class="agent-empty">
      <div class="mark">e</div>
      <div class="enpii">enpii</div>
      <div class="hint">
        Ask anything about <strong style="color:#fff">{app.activeProject.name}</strong>.
        <br />
        Tools: list_dir · read_file · glob · grep · write_file · edit_file
      </div>
    </div>
  {:else}
    {#if app.planMode}
      <div class="plan-mode-banner" role="status">
        <strong>Plan mode</strong>
        <span>Writes, shell, git, MCP, and sub-agents blocked until exit_plan_mode</span>
      </div>
    {/if}
    {#if app.ask && !app.messages.some((m) => m.tool?.callId === app.ask?.toolCallId || m.tool?.callId === app.ask?.requestId)}
      <div class="action-card ask-card sticky-ask">
        <div class="action-head">
          <div class="action-head-left">
            <span>Question</span>
            {#if app.pendingAsks.length > 1}
              <span class="action-queue-count">{app.pendingAsks.length} pending</span>
            {/if}
          </div>
          <span class="action-badge">ask_user</span>
        </div>
        <div class="action-body">
          <p class="action-copy">{app.ask.question}</p>
          {#if app.ask.options?.length}
            <div class="ask-options">
              {#each app.ask.options as opt (opt)}
                <button type="button" class="btn-allow-full" onclick={() => submitAsk(app.ask!.requestId, opt)}>{opt}</button>
              {/each}
            </div>
          {/if}
          <div class="ask-free">
            <input
              type="text"
              class="ask-input"
              placeholder="Type an answer…"
              value={askDraft(app.ask.requestId)}
              oninput={(e) => setAskDraft(app.ask!.requestId, (e.currentTarget as HTMLInputElement).value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitAsk(app.ask!.requestId)
                }
              }}
            />
            <button
              type="button"
              class="btn-allow-full"
              disabled={!askDraft(app.ask.requestId).trim()}
              onclick={() => submitAsk(app.ask!.requestId)}
            >Submit</button>
          </div>
        </div>
      </div>
    {/if}
    {#if app.run}
      <section class="agent-task-panel">
        <div class="agent-task-head"><div><strong>Task</strong><span class="task-run-status {app.run.status}">{app.run.status}</span><span class="task-progress">{app.run.tasks.filter((task) => task.status === 'completed').length}/{app.run.tasks.length} steps · {app.run.toolCount ?? 0} tools</span></div><div class="agent-task-actions">{#if app.busy}<button type="button" class="danger" onclick={() => void stopAgentTurn()}>Stop</button>{:else}<button type="button" disabled={!lastUserPrompt()} onclick={() => void retryRun()}>Retry</button><button type="button" onclick={() => void continueRun()}>Continue</button>{/if}</div></div>
        {#if app.run.lastEvent}<div class="agent-task-last-event">{app.run.lastEvent}</div>{/if}
        <div class="agent-task-list">
          {#each app.run.tasks as task (task.id)}
            <div class="agent-task-row {task.status}"><span class="task-dot"></span><div class="agent-task-copy"><span>{task.title}</span>{#if task.detail}<small>{task.detail}</small>{/if}</div>{#if task.toolCount}<small class="task-tool-count">{task.toolCount} tools</small>{/if}<small class="task-status">{task.status}</small></div>
          {/each}
        </div>
        {#if app.approvals.length > 0}
          <details class="approval-history"><summary>Approval history · {app.approvals.length}</summary>{#each app.approvals.slice(0, 8) as approval (`${approval.ts}-${approval.name}`)}<details class="approval-entry"><summary><span class="approval-decision {approval.decision}">{approval.decision}</span><span>{approval.summary}</span><time>{new Date(approval.ts).toLocaleTimeString()}</time></summary>{#if approval.preview}<pre>{approval.preview}</pre>{/if}{#if approval.args}<code>{approval.args}</code>{/if}</details>{/each}</details>
        {/if}
      </section>
    {/if}
    {#if app.checkpoints.length > 0}
      <section class="agent-checkpoints">
        <div class="agent-checkpoints-head"><strong>Agent Checkpoints</strong><button type="button" disabled={checkpointBusy} onclick={() => void loadCheckpoints()}>Refresh</button></div>
        {#each app.checkpoints as checkpoint (checkpoint.id)}
          <details class="agent-checkpoint">
            <summary><span>{new Date(checkpoint.createdAt).toLocaleTimeString()}</span><span>{checkpoint.files.length} file{checkpoint.files.length === 1 ? '' : 's'}</span></summary>
            <div class="agent-checkpoint-files">
              {#each checkpoint.files as file (file.path)}
                <div><span>{file.path}</span><span class="checkpoint-file-actions"><button type="button" disabled={checkpointBusy} onclick={() => void acceptCheckpoint(checkpoint.id, file.path)}>Accept</button><button type="button" disabled={checkpointBusy} onclick={() => requestRollbackCheckpoint(checkpoint.id, file.path)}>Revert</button></span></div>
              {/each}
              <div class="checkpoint-turn-actions"><button type="button" disabled={checkpointBusy} onclick={() => void acceptCheckpoint(checkpoint.id)}>Accept turn</button>{#if checkpoint.prompt}<button type="button" disabled={checkpointBusy || app.busy} onclick={() => requestRetryCheckpoint(checkpoint.id, checkpoint.prompt)}>Retry</button>{/if}<button type="button" class="checkpoint-revert-all" disabled={checkpointBusy} onclick={() => requestRollbackCheckpoint(checkpoint.id)}>Revert turn</button></div>
            </div>
          </details>
        {/each}
      </section>
    {/if}
    <div class="timeline">
      {#each groups as g, gi (g.kind === 'turn' ? `t-${gi}-${g.items[0]?.id}` : g.m.id)}
        {#if g.kind === 'user'}
          <div class="msg-user">
            <div class="bubble">
              {#if g.m.text}<div class="bubble-text">{g.m.text}</div>{/if}
            </div>
          </div>
        {:else if g.kind === 'system'}
          <div class="msg-system">{g.m.text}</div>
        {:else}
          <div class="msg-assistant">
            <div class="avatar">e</div>
            <div class="turn-body">
              {#each g.items as m (m.id)}
                {#if m.role === 'assistant'}
                  {#if m.text}
                    <div class="body md">{@html renderMarkdown(m.text)}</div>
                  {/if}
                {:else if m.role === 'tool' && m.tool}
                  {@const pending = pendingForTool(m.tool.callId)}
                  {@const askPending = pendingAskForTool(m.tool.callId)}
                  {#if askPending}
                    <div class="action-card ask-card">
                      <div class="action-head">
                        <div class="action-head-left">
                          <span>Question</span>
                          {#if app.pendingAsks.length > 1}
                            <span class="action-queue-count">{app.pendingAsks.length} pending</span>
                          {/if}
                        </div>
                        <span class="action-badge">ask_user</span>
                      </div>
                      <div class="action-body">
                        <p class="action-copy">{askPending.question}</p>
                        {#if askPending.options?.length}
                          <div class="ask-options">
                            {#each askPending.options as opt (opt)}
                              <button type="button" class="btn-allow-full" onclick={() => submitAsk(askPending.requestId, opt)}>{opt}</button>
                            {/each}
                          </div>
                        {/if}
                        <div class="ask-free">
                          <input
                            type="text"
                            class="ask-input"
                            placeholder="Type an answer…"
                            value={askDraft(askPending.requestId)}
                            oninput={(e) => setAskDraft(askPending.requestId, (e.currentTarget as HTMLInputElement).value)}
                            onkeydown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                submitAsk(askPending.requestId)
                              }
                            }}
                          />
                          <button
                            type="button"
                            class="btn-allow-full"
                            disabled={!askDraft(askPending.requestId).trim()}
                            onclick={() => submitAsk(askPending.requestId)}
                          >Submit</button>
                        </div>
                      </div>
                    </div>
                  {:else if pending}
                    <div class="action-card">
                      <div class="action-head">
                        <div class="action-head-left">
                          <svg
                            class="action-ico"
                            width="16"
                            height="16"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clip-rule="evenodd"
                            ></path>
                          </svg>
                          <span>Action Required</span>
                          {#if app.pendingApprovals.length > 1}
                            <span class="action-queue-count">{app.pendingApprovals.length} pending</span>
                          {/if}
                        </div>
                        <span class="action-badge">
                            {approvalKind(pending.name)}
                          </span>
                      </div>
                      <div class="action-body">
                        <p class="action-copy">
                          <span class="enpii-name">enpii</span> wants to {approvalVerb(pending.name)}
                          <code class="path-chip">{approvalPath(pending)}</code>
                        </p>
                        {#if pending.preview}
                          {#if isUnifiedDiff(pending.preview)}
                            <div class="diff-view">
                              {#each pending.preview.split('\n') as line, li (`d-${li}`)}
                                <div class="diff-line {diffLineClass(line)}">{line || ' '}</div>
                              {/each}
                            </div>
                          {:else}
                            <pre class="action-preview">{pending.preview}</pre>
                          {/if}
                        {/if}
                        <div class="action-actions">
                          <button
                            type="button"
                            class="btn-deny-full"
                            onclick={() => void respondApproval('deny', pending.requestId)}
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            class="btn-allow-full"
                            onclick={() => void respondApproval('allow', pending.requestId)}
                          >
                            {approvalButton(pending.name)}
                          </button>
                          <button
                            type="button"
                            class="btn-allow-full"
                            title="Auto-allow this action kind for the rest of the session"
                            onclick={() => void respondApproval('allow', pending.requestId, 'session')}
                          >
                            Allow for session
                          </button>
                        </div>
                        {#if app.pendingApprovals.length > 1 && app.pendingApprovals[0]?.requestId === pending.requestId}
                          <div class="action-batch">
                            <button type="button" class="btn-deny-full" onclick={() => void respondAllApprovals('deny')}>
                              Deny all ({app.pendingApprovals.length})
                            </button>
                            <button type="button" class="btn-allow-full" onclick={() => void respondAllApprovals('allow')}>
                              Allow all ({app.pendingApprovals.length})
                            </button>
                            <button
                              type="button"
                              class="btn-allow-full"
                              title="Allow these kinds for the rest of the session"
                              onclick={() => void respondAllApprovals('allow', 'session')}
                            >
                              Allow all for session
                            </button>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {:else if isTerminalTool(m.tool.name)}
                    <details
                      class="tool-card term-block"
                      class:running={m.tool.status === 'running'}
                      class:ok={m.tool.status === 'ok'}
                      class:err={m.tool.status === 'error'}
                    >
                      <summary class="tool-row">
                        <div class="tool-left">
                          <span class="tool-dot"></span>
                          <span class="tool-name">tool:{m.tool.name}</span>
                          <span class="tool-path term-cmd">{shellCommand(m)}</span>
                        </div>
                        <span class="tool-status">{statusLabel(m, false)}</span>
                      </summary>
                      <div class="term-chrome">
                        <span class="term-prompt">$</span>
                        <code class="term-cmd-line">{shellCommand(m)}</code>
                        {#if m.tool.preview && m.tool.status !== 'running'}
                          <button
                            type="button"
                            class="term-copy"
                            onclick={(e) => {
                              e.preventDefault()
                              void copyToolOutput(m.tool?.preview ?? '')
                            }}
                          >
                            Copy
                          </button>
                        {/if}
                      </div>
                      {#if m.tool.preview && m.tool.status !== 'running'}
                        <pre class="tool-preview term-out">{m.tool.preview}</pre>
                      {:else if m.tool.status === 'running'}
                        <div class="tool-preview muted term-out">Running…</div>
                      {:else}
                        <div class="tool-preview muted term-out">No output</div>
                      {/if}
                    </details>
                  {:else}
                    <details
                      class="tool-card"
                      class:running={m.tool.status === 'running'}
                      class:ok={m.tool.status === 'ok'}
                      class:err={m.tool.status === 'error'}
                    >
                      <summary class="tool-row">
                        <div class="tool-left">
                          <span class="tool-dot"></span>
                          <span class="tool-name">tool:{m.tool.name}</span>
                          <span class="tool-path">{toolLabel(m)}</span>
                        </div>
                        <span class="tool-status">{statusLabel(m, false)}</span>
                      </summary>
                      {#if m.tool.preview && m.tool.status !== 'running'}
                        <pre class="tool-preview">{m.tool.preview}</pre>
                      {:else if m.tool.status === 'running'}
                        <div class="tool-preview muted">Running…</div>
                      {:else}
                        <div class="tool-preview muted">No output</div>
                      {/if}
                    </details>
                  {/if}
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<footer class="composer" class:hidden-pane={agentPane !== 'enpii'}>
  <div class="composer-inner" role="group" aria-label="Message composer">
    <textarea
      rows="3"
      bind:this={composerEl}
      placeholder={app.activeProject
        ? 'Message the agent… (Use @ to reference files)'
        : 'Open a project first'}
      bind:value={app.composer}
      onkeydown={onKeydown}
      oninput={onComposerInput}
      onclick={syncMentionCaret}
      onkeyup={syncMentionCaret}
      onselect={syncMentionCaret}
      onpaste={onPaste}
      onblur={onComposerBlur}
      disabled={!app.activeProject || app.busy}
    ></textarea>
    <div class="composer-bar">
      <div class="composer-tools">
        <SmartSelect
          value={app.composerMode}
          options={[...COMPOSER_MODES]}
          ariaLabel="Composer mode"
          title="Shift+Tab: cycle composer mode"
          class="composer-mode-picker"
          disabled={app.busy}
          onChange={(value) => void changeComposerMode(value)}
        />
        <button type="button" title="Attach files" aria-label="Attach files" onclick={() => void attachFiles()}>
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            ></path>
          </svg>
        </button>
        {#if app.attachments.length}
          <span class="attachment-budget" title={app.attachments.map((f) => f.name).join(', ')}>
            {app.attachments.length} file{app.attachments.length === 1 ? '' : 's'} · ~{attachmentTokens().toLocaleString()} tok
          </span>
        {/if}
      </div>
      <button
        type="button"
        class="btn-send"
        onclick={onSend}
        disabled={!app.activeProject || app.busy}
      >
        {app.busy ? 'Running…' : 'Send'}
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z"
          ></path>
        </svg>
      </button>
    </div>
    {#if activeMention && (mentionResults.length > 0 || mentionLoading)}
      <div class="slash-suggestions mention-suggestions" role="listbox" aria-label="File references">
        {#if mentionLoading && mentionResults.length === 0}
          <div class="mention-empty">Searching…</div>
        {:else}
          {#each mentionResults as path, index (path)}
            <button type="button" class:active={index === mentionActive} onclick={() => applyMention(path)} onmouseenter={() => (mentionActive = index)}>
              <span><strong>{mentionLabel(path)}</strong><small>{path === '__selection__' ? 'Current Code selection' : 'Project file'}</small></span>
            </button>
          {/each}
        {/if}
      </div>
    {:else if slashSuggestions.length > 0}
      <div class="slash-suggestions" role="listbox" aria-label="Slash commands">
        {#each slashSuggestions as command, index (command.name)}
          <button type="button" class:active={index === slashActive} onclick={() => { app.composer = `${command.name} `; composerEl?.focus() }} onmouseenter={() => (slashActive = index)}>
            <span><strong>{command.usage}</strong><small>{command.description}</small></span>
          </button>
        {/each}
      </div>
    {/if}
    {#if attachmentPreviewId}
      {@const preview = app.attachments.find((file) => file.id === attachmentPreviewId)}
      {#if preview}
        <section class="attachment-preview"><header><strong>{preview.name}</strong><span>{preview.kind} · {(preview.size / 1024).toFixed(1)} KB{#if preview.images?.length} · {preview.images.length} image{/if}</span><button type="button" aria-label="Close attachment preview" onclick={() => (attachmentPreviewId = null)}>×</button></header>{#if preview.error}<div class="attachment-preview-error">{preview.error}</div>{:else}<pre>{preview.content.slice(0, 4_000) || '[vision image]'}</pre>{/if}</section>
      {/if}
    {/if}
  </div>
</footer>
</div>

<ConfirmDialog
  open={checkpointConfirm != null}
  title={checkpointConfirm?.kind === 'retry'
    ? 'Retry turn?'
    : checkpointConfirm?.path
      ? `Revert ${checkpointConfirm.path}?`
      : 'Revert turn?'}
  message={checkpointConfirm?.kind === 'retry'
    ? 'Revert turn lalu jalankan ulang prompt?'
    : checkpointConfirm?.path
      ? 'File dikembalikan ke state sebelum turn.'
      : 'Semua file dari turn ini akan di-revert.'}
  cancelLabel="Batal"
  confirmLabel={checkpointConfirm?.kind === 'retry' ? 'Retry' : 'Revert'}
  danger
  onCancel={() => (checkpointConfirm = null)}
  onConfirm={() => void confirmCheckpointAction()}
/>

<svelte:window
  onkeydown={(e) => {
    onVendorMenuKey(e)
    onWindowKeydown(e)
  }}
  onpointerdown={onVendorMenuOutside}
/>
