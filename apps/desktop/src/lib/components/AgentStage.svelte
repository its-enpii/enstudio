<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { state as app, COMPOSER_MODES, fontStack, EDITOR_FONT_SIZE, type ChatMessage, type ComposerAttachment, type ComposerMode, type PermissionMode } from '../store.svelte'
  import { t } from '../i18n/index.svelte'
  import { acceptAgentCheckpoint, approveDiskPlan, compactSession, exportSessionMarkdown, getAgentCheckpoints, newSession, openSession, readProjectFile, refreshDraftPlan, refreshSessionList, refreshTeamSurface, rejectDiskPlan, respondApproval, respondAsk, rollbackAgentCheckpoint, saveProviderConfig, searchProjectFiles, sendPrompt, setSessionPlanMode, stopAgentTurn, undoCompactSession } from '../enpii'
  import { renderMarkdown } from '../markdown'
  import { xtermTheme } from '../theme'
  import SmartSelect from './ui/SmartSelect.svelte'
  import ConfirmDialog from './ui/ConfirmDialog.svelte'
  import { Button, Dropdown, Modal, type DropdownItem } from './ui'
  import { Icon } from '../icons'

  type AgentPane = 'enpii' | string
  type VendorKind = 'claude' | 'codex' | 'opencode' | 'gemini'
  type VendorProvider = { baseUrl?: string; apiKey?: string; model?: string }
  type VendorTab = { id: string; kind: VendorKind; label: string; provider?: VendorProvider }
  const VENDOR_CLIS = [
    { id: 'claude' as const, label: 'Claude', command: 'claude', args: [] as string[] },
    { id: 'codex' as const, label: 'Codex', command: 'codex', args: [] as string[] },
    { id: 'opencode' as const, label: 'OpenCode', command: 'opencode', args: [] as string[] },
    { id: 'gemini' as const, label: 'Gemini', command: 'gemini', args: [] as string[] },
  ]

  let agentPane = $state<AgentPane>('enpii')
  let vendorHost = $state<HTMLDivElement>()
  let vendorError = $state('')
  let vendorBusy = $state(false)
  /** Open vendor instances (multi of same kind OK). Default none — enpii only. */
  let vendorTabs = $state<VendorTab[]>([])
  let vendorSeq = 0
  let vendorConfigOpen = $state(false)
  let vendorConfigKind = $state<VendorKind | null>(null)
  let vendorConfig = $state({ model: '' })
  const vendorTerms = new Map<string, { ptyId: string; term: Terminal; fit: FitAddon; size: { cols: number; rows: number }; kind: VendorKind }>()
  const vendorMenuItems = $derived<DropdownItem[]>(
    app.activeProject
      ? VENDOR_CLIS.map((cli) => {
          const n = kindOpenCount(cli.id)
          return {
            id: cli.id,
            label: cli.label,
            description: n ? `${cli.command} · ${n} open · +` : cli.command,
          }
        })
      : [{ id: '_none', label: 'Open a project first', disabled: true }],
  )
  const vendorPending = new Map<string, string>()
  let vendorResizeTimer: ReturnType<typeof setTimeout> | undefined
  let vendorResizeObs: ResizeObserver | undefined
  let vendorDestroyed = false
  let vendorProjectId: string | null = null
  const termApi = typeof window !== 'undefined' ? window.enpiistudio?.terminal : undefined

  function kindOpenCount(kind: VendorKind): number {
    return vendorTabs.filter((t) => t.kind === kind).length
  }

  function nextVendorLabel(kind: VendorKind, base: string): string {
    const n = kindOpenCount(kind) + 1
    return n === 1 ? base : `${base} ${n}`
  }

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

  async function ensureVendor(tabId: string, kind: VendorKind, provider?: VendorProvider): Promise<void> {
    if (!app.activeProject || !termApi) return
    if (vendorTerms.has(tabId)) {
      await tick()
      await mountVendorTerm(tabId)
      return
    }
    const cli = VENDOR_CLIS.find((c) => c.id === kind)
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
        provider,
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
        fontFamily: fontStack(app.ui.fontFamily),
        fontSize: EDITOR_FONT_SIZE,
        lineHeight: 1.25,
        scrollback: 5_000,
        drawBoldTextInBrightColors: false,
        theme: { ...xtermTheme },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.onData((data) => void termApi.write(created.id, data))
      const buffered = vendorPending.get(created.id)
      if (buffered) {
        term.write(buffered)
        vendorPending.delete(created.id)
      }
      vendorTerms.set(tabId, {
        ptyId: created.id,
        term,
        fit,
        size: { cols: seed.cols, rows: seed.rows },
        kind,
      })
      await mountVendorTerm(tabId)
    } catch (err) {
      vendorError = err instanceof Error ? err.message : String(err)
    } finally {
      vendorBusy = false
    }
  }

  async function selectAgentPane(pane: AgentPane): Promise<void> {
    agentPane = pane
    if (pane === 'enpii') {
      vendorHost?.replaceChildren()
      void tick().then(focusComposer)
      return
    }
    const tab = vendorTabs.find((t) => t.id === pane)
    if (!tab) return
    await ensureVendor(tab.id, tab.kind, tab.provider)
  }

  const vendorModelOptions = $derived.by(() => {
    const list = app.provider?.models?.length
      ? app.provider.models
      : app.provider?.model
        ? [app.provider.model]
        : ['enpii']
    const out: string[] = []
    for (const m of list) if (m && !out.includes(m)) out.push(m)
    return out.map((m) => ({ value: m, label: m }))
  })

  function openVendorConfig(kind: VendorKind): void {
    if (!app.activeProject) return
    vendorConfigKind = kind
    vendorConfig = {
      model: app.provider?.model ?? vendorModelOptions[0]?.value ?? '',
    }
    vendorConfigOpen = true
  }

  function closeVendorConfig(): void {
    vendorConfigOpen = false
    vendorConfigKind = null
  }

  async function confirmVendorConfig(): Promise<void> {
    const kind = vendorConfigKind
    if (!kind) return
    const cli = VENDOR_CLIS.find((c) => c.id === kind)
    if (!cli) return
    // Base URL + key always from Settings; modal only picks model.
    const provider: VendorProvider = {
      model: vendorConfig.model.trim() || undefined,
    }
    const id = `${kind}-${++vendorSeq}`
    const tab: VendorTab = {
      id,
      kind,
      label: nextVendorLabel(kind, cli.label),
      provider,
    }
    vendorTabs = [...vendorTabs, tab]
    closeVendorConfig()
    agentPane = id
    await ensureVendor(id, kind, provider)
  }

  async function closeVendor(tabId: string): Promise<void> {
    const entry = vendorTerms.get(tabId)
    if (entry) {
      await termApi?.kill(entry.ptyId)
      entry.term.dispose()
      vendorTerms.delete(tabId)
    }
    vendorTabs = vendorTabs.filter((t) => t.id !== tabId)
    if (agentPane === tabId) {
      agentPane = 'enpii'
      vendorHost?.replaceChildren()
      void tick().then(focusComposer)
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
      for (const entry of vendorTerms.values()) {
        if (entry.ptyId !== id) continue
        entry.term.write(`\r\n\x1b[90m[process exited ${exitCode}]\x1b[0m\r\n`)
        // Keep tab; user re-open via + menu or close+add.
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

  // Live mono family + re-fit after UI zoom.
  $effect(() => {
    const family = fontStack(app.ui.fontFamily)
    void app.ui.uiZoom
    for (const entry of vendorTerms.values()) {
      entry.term.options.fontFamily = family
      entry.term.options.fontSize = EDITOR_FONT_SIZE
    }
    fitVendor(true)
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
    const name = m.tool?.name ?? ''
    const s = m.tool?.summary ?? m.tool?.args ?? ''
    if (name === 'agent' || name === 'send_message') {
      try {
        const o = JSON.parse(m.tool?.args || '{}') as {
          role?: string
          description?: string
          name?: string
          agentId?: string
        }
        const role = o.role ? `${o.role} · ` : ''
        const who = o.description || o.name || o.agentId || ''
        if (who) return `${role}${who}`.slice(0, 64)
      } catch {
        /* fall through */
      }
      const spawn = s.match(/Spawned sub-agent\s+(\S+)(?:\s+\(([^)]+)\))?/i)
      if (spawn) return `sub ${spawn[2] || spawn[1]}`.slice(0, 48)
    }
    if (name.startsWith('task_')) {
      const id = s.match(/\b([a-f0-9]{8})\b/i)
      const title = s.match(/(?:created|updated|stopped)\s+#?[a-f0-9]{0,8}\s*(.+?)(?:\n|$)/i)
      if (title?.[1]?.trim()) return title[1]!.trim().slice(0, 48)
      if (id) return `#${id[1]}`
    }
    if (name.startsWith('mailbox_')) {
      const to = s.match(/\bto[=:\s]+(\S+)/i)
      if (to) return `→ ${to[1]}`.slice(0, 48)
      return s.slice(0, 48) || 'mail'
    }
    // "edit_file path=README.md …" / "write_file README.md (created…)"
    const pathEq = s.match(/\bpath=([^\s]+)/)
    if (pathEq) return pathEq[1]!.replace(/^["']|["']$/g, '')
    const named = s.match(
      /^(?:list_dir|read_file|glob|grep|write_file|edit_file)\s+(\S+)/,
    )
    if (named) return named[1]!.replace(/^["']|["']$/g, '')
    return s.slice(0, 48)
  }

  function toolDisplayName(name: string): string {
    if (name === 'agent') return 'sub-agent'
    if (name === 'send_message') return 'message'
    if (name === 'agent_apply') return 'apply'
    if (name === 'agent_discard') return 'discard'
    if (name === 'task_create') return 'task+'
    if (name === 'task_update') return 'task'
    if (name === 'task_stop') return 'task×'
    if (name === 'task_list' || name === 'task_get') return 'board'
    if (name === 'mailbox_send') return 'mail→'
    if (name === 'mailbox_inbox') return 'mail'
    if (name === 'mailbox_broadcast') return 'mail※'
    return name
  }

  function isTeamTool(name: string): boolean {
    return (
      name === 'agent' ||
      name === 'send_message' ||
      name === 'agent_apply' ||
      name === 'agent_discard' ||
      name.startsWith('task_') ||
      name.startsWith('mailbox_')
    )
  }

  function teamStatusDot(status: string): string {
    if (status === 'running' || status === 'in_progress') return 'bg-studio-gold'
    if (status === 'error') return 'bg-studio-error'
    if (status === 'idle' || status === 'pending') return 'bg-studio-text-dim'
    if (status === 'completed') return 'bg-studio-success'
    return 'bg-white/30'
  }

  const showTeamStrip = $derived(
    app.teamBoard.length > 0 || app.teamMail.length > 0 || app.teamSubs.length > 0,
  )

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

  function prettyApprovalArgs(raw?: string): string {
    if (!raw?.trim()) return '{\n  \n}'
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }

  function syncApprovalEditDraft(requestId: string, args?: string): void {
    if (approvalEditForId === requestId) return
    approvalEditForId = requestId
    approvalEditOpen = false
    approvalDenyOpen = false
    approvalEditError = ''
    approvalDenyReason = ''
    approvalEditText = prettyApprovalArgs(args)
  }

  function allowSticky(requestId: string, scope: 'once' | 'session' = 'once'): void {
    approvalEditError = ''
    if (approvalEditOpen) {
      const trimmed = approvalEditText.trim()
      if (!trimmed) {
        approvalEditError = 'Args required'
        return
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          approvalEditError = 'Args must be a JSON object'
          return
        }
      } catch {
        approvalEditError = 'Invalid JSON'
        return
      }
      void respondApproval('allow', requestId, scope, { editedArgs: trimmed })
      return
    }
    void respondApproval('allow', requestId, scope)
  }

  function denySticky(requestId: string): void {
    const reason = approvalDenyReason.trim()
    void respondApproval('deny', requestId, 'once', reason ? { reason } : undefined)
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
    const value = text.trimEnd()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      /* ignore */
    }
  }

  /** Terminal-style prompt history (↑/↓). Newest last. */
  const PROMPT_HISTORY_KEY = 'enpiistudio.composerHistory'
  const PROMPT_HISTORY_MAX = 50
  let promptHistory = $state<string[]>(loadPromptHistory())
  /** -1 = live draft; 0..len-1 = browsing history. */
  let historyIndex = $state(-1)
  let historyDraft = $state('')

  function loadPromptHistory(): string[] {
    try {
      const raw = localStorage.getItem(PROMPT_HISTORY_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(-PROMPT_HISTORY_MAX)
    } catch {
      return []
    }
  }

  function persistPromptHistory(list: string[]): void {
    try {
      localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(list.slice(-PROMPT_HISTORY_MAX)))
    } catch {
      /* ignore quota */
    }
  }

  function ensurePromptHistory(): string[] {
    if (promptHistory.length) return promptHistory
    const fromSession = app.messages
      .filter((m) => m.role === 'user' && m.text?.trim())
      .map((m) => m.text!.trim())
    if (!fromSession.length) return promptHistory
    const next = fromSession.slice(-PROMPT_HISTORY_MAX)
    promptHistory = next
    persistPromptHistory(next)
    return next
  }

  function pushPromptHistory(text: string): void {
    const t = text.trim()
    if (!t) return
    const next = promptHistory.filter((item) => item !== t)
    next.push(t)
    if (next.length > PROMPT_HISTORY_MAX) next.splice(0, next.length - PROMPT_HISTORY_MAX)
    promptHistory = next
    persistPromptHistory(next)
    historyIndex = -1
    historyDraft = ''
  }

  function caretLineInfo(el: HTMLTextAreaElement): { line: number; lines: number } {
    const value = el.value ?? ''
    const pos = el.selectionStart ?? 0
    const before = value.slice(0, pos)
    const line = before.split('\n').length - 1
    const lines = value.length === 0 ? 1 : value.split('\n').length
    return { line, lines }
  }

  /** ↑ on first line / ↓ on last line (or while browsing) — like shell history. */
  function canBrowseHistory(el: HTMLTextAreaElement, key: 'ArrowUp' | 'ArrowDown'): boolean {
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start !== end) return false
    if (historyIndex >= 0) return true
    const value = el.value ?? ''
    if (!value.trim()) return key === 'ArrowUp' || key === 'ArrowDown'
    const { line, lines } = caretLineInfo(el)
    if (key === 'ArrowUp') return line <= 0
    return line >= lines - 1
  }

  function applyHistoryEntry(text: string): void {
    app.composer = text
    if (composerEl) {
      composerEl.value = text
      const pos = text.length
      composerEl.setSelectionRange(pos, pos)
      mentionCaret = pos
    } else {
      void tick().then(() => {
        if (!composerEl) return
        composerEl.focus()
        const pos = text.length
        composerEl.setSelectionRange(pos, pos)
        mentionCaret = pos
      })
    }
  }

  function historyOlder(): void {
    const list = ensurePromptHistory()
    if (!list.length) return
    if (historyIndex < 0) {
      historyDraft = composerEl?.value ?? app.composer
      historyIndex = list.length - 1
    } else if (historyIndex > 0) {
      historyIndex -= 1
    } else {
      return
    }
    applyHistoryEntry(list[historyIndex] ?? '')
  }

  function historyNewer(): void {
    if (historyIndex < 0) return
    const list = promptHistory
    if (historyIndex < list.length - 1) {
      historyIndex += 1
      applyHistoryEntry(list[historyIndex] ?? '')
      return
    }
    historyIndex = -1
    applyHistoryEntry(historyDraft)
    historyDraft = ''
  }

  function pendingForTool(callId: string) {
    // One card at a time: only the head of the queue is interactive.
    // Other pending tools keep waiting; next head appears after this one settles.
    const head = app.pendingApprovals[0]
    if (!head) return null
    if (head.toolCallId !== callId && head.requestId !== callId) return null
    return head
  }

  function pendingAskForTool(callId: string) {
    const head = app.pendingAsks[0]
    if (!head) return null
    if (head.toolCallId !== callId && head.requestId !== callId) return null
    return head
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
    askFocusIndex = -1
    void respondAsk(text, requestId)
  }

  /** Keyboard highlight index on the head ask card (−1 = free-text / none). */
  let askFocusIndex = $state(-1)

  $effect(() => {
    // Reset highlight when the head ask changes.
    void app.ask?.requestId
    askFocusIndex = -1
  })

  function onAskCardKeydown(e: KeyboardEvent, requestId: string, options?: { label: string }[]): void {
    const n = options?.length ?? 0
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'ArrowDown') {
        askFocusIndex = askFocusIndex < 0 ? 0 : (askFocusIndex + 1) % n
      } else {
        askFocusIndex = askFocusIndex < 0 ? n - 1 : (askFocusIndex - 1 + n) % n
      }
      return
    }
    if (e.key === 'Enter') {
      if (askFocusIndex >= 0 && options?.[askFocusIndex]) {
        e.preventDefault()
        e.stopPropagation()
        submitAsk(requestId, options[askFocusIndex]!.label)
        return
      }
      // Free-text Enter handled on the input itself.
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      askFocusIndex = -1
    }
  }

  function diffLineClass(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'text-studio-text-dim'
    if (line.startsWith('@@')) return 'bg-studio-link/12 text-studio-link'
    if (line.startsWith('+')) return 'bg-studio-success/20 text-studio-success-bright'
    if (line.startsWith('-')) return 'bg-studio-error/20 text-studio-error'
    return 'text-studio-text/75'
  }

  function toolBorder(status: string): string {
    if (status === 'ok') return 'border-l-studio-success'
    if (status === 'error') return 'border-l-studio-error'
    return 'border-l-studio-gold'
  }

  function toolAccent(status: string): string {
    if (status === 'ok') return 'text-studio-success-bright'
    if (status === 'error') return 'text-studio-error'
    return 'text-studio-gold'
  }

  function toolDot(status: string): string {
    if (status === 'ok') return 'bg-studio-success'
    if (status === 'error') return 'bg-studio-error'
    return 'bg-studio-gold'
  }

  function isUnifiedDiff(text: string): boolean {
    return text.startsWith('--- ') || text.includes('\n+++ ') || text.startsWith('+++ ')
  }

  let stageEl: HTMLDivElement | undefined
  let composerEl: HTMLTextAreaElement | undefined
  let stickBottom = $state(true)
  let checkpointBusy = $state(false)
  /** Sticky approval: edit tool args / deny reason. */
  let approvalEditOpen = $state(false)
  let approvalEditText = $state('')
  let approvalEditError = $state('')
  let approvalDenyOpen = $state(false)
  let approvalDenyReason = $state('')
  let approvalEditForId = $state<string | null>(null)
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
        app.notify('warning', t('agent.attach.limit'), t('agent.attach.maxFiles'))
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
        t('agent.attach.rejected'),
        rejected.length === 1
          ? `${first.name}: ${first.error}`
          : t('agent.attach.rejectedCount', {
              count: rejected.length,
              name: first.name,
              error: first.error ?? '',
            }),
      )
    }
  }

  async function attachFiles(): Promise<void> {
    try {
      addAttachments(await window.enpiistudio.dialog.openFiles())
    } catch (err) {
      app.notify('error', t('agent.attach.failed'), err instanceof Error ? err.message : String(err))
    }
  }

  async function addAttachmentsFromPaths(paths: string[]): Promise<void> {
    if (!paths.length) return
    try {
      addAttachments(await window.enpiistudio.dialog.parseFiles(paths))
      void tick().then(focusComposer)
    } catch (err) {
      app.notify('error', t('agent.attach.failed'), err instanceof Error ? err.message : String(err))
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
      COMPOSER_MODES.find((m) => m.value.toLowerCase().replace(/[-_\s]/g, '') === compact) ??
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
      // Composer Plan = runtime planMode (mutations blocked until approve + exit).
      const wantPlan = selected.value === 'plan'
      if (wantPlan !== app.planMode) await setSessionPlanMode(wantPlan)
      app.notify(
        'info',
        t(selected.labelKey),
        wantPlan ? `${selected.permission} · plan mode ON` : selected.permission,
      )
    } catch (err) {
      app.notify('error', 'Mode gagal', err instanceof Error ? err.message : String(err))
    }
  }

  const slashCommands = $derived.by((): SlashCommand[] => {
    const list: SlashCommand[] = [
      {
        name: '/help',
        usage: '/help',
        description: t('agent.slash.help.desc'),
        run: () => addSystem(list.map((command) => `${command.usage} - ${command.description}`).join('\n')),
      },
      {
        name: '/session',
        usage: '/session [new|list|ID]',
        description: t('agent.slash.session.desc'),
        run: async (args) => {
          const value = args.trim()
          if (value === 'new') return newSession()
          await refreshSessionList()
          if (value && value !== 'list') {
            const target = app.sessionList.find((session) => session.id === value || session.id.startsWith(value))
            if (target) return openSession(target.id)
          }
          addSystem(
            app.sessionList.length
              ? app.sessionList
                  .map((session) => `${session.id.slice(0, 8)}… · ${session.title} · ${session.messageCount ?? 0} messages`)
                  .join('\n')
              : t('agent.slash.session.empty'),
          )
        },
      },
      {
        name: '/compact',
        usage: '/compact',
        description: t('agent.slash.compact.desc'),
        run: async () => {
          const result = await compactSession()
          addSystem(`Context compacted: ${result.originalMessageCount} messages → 1 summary. Undo: /undo-compact`)
        },
      },
      {
        name: '/undo-compact',
        usage: '/undo-compact',
        description: t('agent.slash.undoCompact.desc'),
        run: async () => {
          const result = await undoCompactSession()
          addSystem(`Compact undone · restored ${result.messageCount} messages`)
        },
      },
      {
        name: '/export',
        usage: '/export',
        description: t('agent.slash.export.desc'),
        run: async () => {
          const result = await exportSessionMarkdown()
          addSystem(`Exported ${result.messageCount} messages.`)
        },
      },
      {
        name: '/plan',
        usage: '/plan [goal]',
        description: t('agent.slash.plan.desc'),
        run: async (args) => {
          await changeComposerMode('plan')
          if (args.trim()) await sendPrompt(t('agent.slash.plan.prompt', { goal: args.trim() }))
        },
      },
      {
        name: '/mode',
        usage: '/mode <manual|accept-edits|plan|full-auto>',
        description: t('agent.slash.mode.desc'),
        run: (args) => changeComposerMode(args),
      },
      {
        name: '/review',
        usage: '/review',
        description: t('agent.slash.review.desc'),
        run: () => sendPrompt(t('agent.slash.review.prompt')),
      },
      {
        name: '/test',
        usage: '/test',
        description: t('agent.slash.test.desc'),
        run: () => sendPrompt(t('agent.slash.test.prompt')),
      },
      {
        name: '/commit',
        usage: '/commit [message]',
        description: t('agent.slash.commit.desc'),
        run: (args) =>
          sendPrompt(
            args.trim()
              ? t('agent.slash.commit.promptMsg', { message: args.trim() })
              : t('agent.slash.commit.prompt'),
          ),
      },
      {
        name: '/clear',
        usage: '/clear',
        description: t('agent.slash.clear.desc'),
        run: () => {
          app.messages = []
          app.resetRun()
          app.diffs = []
        },
      },
    ]
    return list
  })

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
    stickBottom = true
  }

  function jumpToBottom(): void {
    stickBottom = true
    void scrollToBottom(true)
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

  /** True when user is drag-selecting chat/inspector text (not in composer). */
  function hasExternalTextSelection(): boolean {
    const sel = document.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false
    const node = sel.anchorNode
    if (!node) return false
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    if (!el) return false
    if (composerEl && (el === composerEl || composerEl.contains(el))) return false
    return true
  }

  /** Set while pointer is down outside composer — blur must not steal focus mid-select. */
  let selectingOutsideComposer = $state(false)

  function focusComposer(force = false) {
    if (agentPane !== 'enpii') return
    if (!composerEl || composerEl.disabled) return
    if (!app.activeProject) return
    if (!force) {
      if (otherTextFieldFocused()) return
      if (selectingOutsideComposer) return
      if (hasExternalTextSelection()) return
      if (document.querySelector('[role="dialog"]')) return
    }
    if (document.activeElement === composerEl) return
    composerEl.focus({ preventScroll: true })
  }

  function composerControlFocused(): boolean {
    return Boolean(composerEl?.closest('.composer-inner')?.contains(document.activeElement))
  }

  function onStagePointerDown(event: PointerEvent): void {
    const t = event.target
    if (!(t instanceof Node)) return
    if (composerEl && (t === composerEl || composerEl.contains(t))) {
      selectingOutsideComposer = false
      return
    }
    if (t instanceof Element && t.closest?.('.composer-inner')) {
      selectingOutsideComposer = false
      return
    }
    selectingOutsideComposer = true
  }

  function onStagePointerUp(): void {
    // Keep flag until selection settles; clear on next tick if no selection.
    requestAnimationFrame(() => {
      if (!hasExternalTextSelection()) selectingOutsideComposer = false
    })
  }

  function cycleComposerMode(): void {
    const index = COMPOSER_MODES.findIndex((mode) => mode.value === app.composerMode)
    const next = COMPOSER_MODES[(index + 1) % COMPOSER_MODES.length]!.value
    void changeComposerMode(next)
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }

  /** Type-to-composer: printable keys land in composer without permanent autofocus. */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (app.mode !== 'agent' || agentPane !== 'enpii' || !app.activeProject) return

    if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
      if (app.busy) return
      event.preventDefault()
      cycleComposerMode()
      return
    }

    // Already in composer / other field / shortcut / dialog → leave alone.
    if (event.defaultPrevented) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.isComposing) return
    if (app.busy) return
    if (!composerEl || composerEl.disabled) return
    if (document.activeElement === composerEl) return
    if (isEditableTarget(event.target)) return
    if (document.querySelector('[role="dialog"]')) return
    // Approval hotkeys (y/n/s) live on window — don't steal them.
    if (app.pendingApprovals.length) {
      const k = event.key.toLowerCase()
      if (k === 'y' || k === 'n' || k === 's') return
    }

    // Printable only (letters, digits, punctuation, space). Not Enter/arrows/F-keys.
    if (event.key.length !== 1) return

    event.preventDefault()
    selectingOutsideComposer = false
    // Drop chat selection so key goes to composer cleanly.
    document.getSelection()?.removeAllRanges()
    focusComposer(true)

    const ch = event.key
    const start = composerEl.selectionStart ?? app.composer.length
    const end = composerEl.selectionEnd ?? start
    const base = composerEl.value ?? app.composer
    const next = `${base.slice(0, start)}${ch}${base.slice(end)}`
    app.composer = next
    composerEl.value = next
    const pos = start + ch.length
    composerEl.setSelectionRange(pos, pos)
    mentionCaret = pos
    onComposerInput()
  }

  $effect(() => {
    void app.activeProject?.id
    void loadCheckpoints()
    void refreshDraftPlan()
    void refreshTeamSurface()
  })

  $effect(() => {
    void app.session?.id
    void refreshDraftPlan()
    void refreshTeamSurface()
  })

  $effect(() => {
    void app.messages.length
    void app.pendingApprovals.length
    void app.pendingAsks.length
    void app.streamingId
    void app.messages[app.messages.length - 1]?.text
    void scrollToBottom()
  })

  // Focus composer when switching project/session/pane — never while user is selecting text.
  $effect(() => {
    void app.activeProject?.id
    void app.session?.id
    void agentPane
    if (agentPane === 'enpii' && app.activeProject && !app.busy && !app.pendingAsks.length) {
      void tick().then(() => focusComposer(false))
    }
  })

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`
    const m = Math.floor(s / 60)
    const rem = Math.round(s % 60)
    return `${m}m ${rem.toString().padStart(2, '0')}s`
  }

  /** Live tick while turn runs — re-renders elapsed label. */
  let nowTick = $state(Date.now())
  $effect(() => {
    if (!app.busy || !app.turnStartedAt) return
    const id = window.setInterval(() => {
      nowTick = Date.now()
    }, 500)
    return () => clearInterval(id)
  })
  const liveElapsed = $derived(
    app.busy && app.turnStartedAt ? formatDuration(Math.max(0, nowTick - app.turnStartedAt)) : '',
  )

  async function onSend() {
    const text = app.composer.trim()
    const chips = attachmentChips()
    if (!text && !chips.length) return
    // Busy → still accept: sendPrompt queues FIFO (composer stays usable).
    if (text.startsWith('/')) {
      if (app.busy) {
        addSystem('Wait until the agent finishes before slash commands.')
        return
      }
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
    pushPromptHistory(displayText || text)
    app.composer = ''
    stickBottom = true
    void scrollToBottom(true)
    try {
      const withRefs = await refsPrompt(text || displayText)
      const prompt = attachmentPrompt(withRefs)
      const imgs = attachmentImages()
      const chipCopy = chips.length ? chips : undefined
      await sendPrompt(prompt, {
        displayText,
        images: imgs,
        attachments: chipCopy,
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

    // Prompt history (terminal-style). Skip when slash/mention menus own arrows.
    if (
      !mentionsOpen &&
      slashSuggestions.length === 0 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      const el = (e.currentTarget instanceof HTMLTextAreaElement ? e.currentTarget : composerEl) ?? null
      const key = e.key as 'ArrowUp' | 'ArrowDown'
      if (el && canBrowseHistory(el, key)) {
        e.preventDefault()
        e.stopPropagation()
        if (key === 'ArrowUp') historyOlder()
        else historyNewer()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void onSend()
    }
  }
</script>

<div
  class="relative col-start-1 row-span-full grid h-full min-h-0 {agentPane !== 'enpii'
    ? 'grid-rows-[auto_minmax(0,1fr)_0fr]'
    : 'grid-rows-[auto_minmax(0,1fr)_auto]'}"
  role="region"
  aria-label="Agent stage"
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  {#if draggingFiles}
    <div
      class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border border-dashed border-studio-lavender-deep/80 bg-studio-panel/95 text-[11px] text-studio-lavender-soft"
    >
      Drop files to attach
    </div>
  {/if}
  <div
    class="relative z-30 flex min-h-[34px] shrink-0 items-stretch gap-0.5 overflow-visible border-b border-white/5 bg-transparent px-2.5 pt-1.5"
    role="tablist"
    aria-label="Agent model"
  >
    <button
      type="button"
      class="cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 py-1.5 text-xs font-medium {agentPane ===
      'enpii'
        ? 'text-white'
        : 'text-studio-text-dim hover:text-white'}"
      role="tab"
      aria-selected={agentPane === 'enpii'}
      onclick={() => void selectAgentPane('enpii')}
    >enpii</button>
    {#each vendorTabs as tab (tab.id)}
      {@const cli = VENDOR_CLIS.find((c) => c.id === tab.kind)}
      {#if cli}
        <div
          class="flex items-stretch rounded-t-lg border border-b-0 {agentPane === tab.id
            ? 'border-border-subtle bg-black/35'
            : 'border-transparent'}"
        >
          <button
            type="button"
            class="cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 py-1.5 text-xs font-medium {agentPane ===
            tab.id
              ? 'text-white'
              : 'text-studio-text-dim hover:text-white'}"
            role="tab"
            aria-selected={agentPane === tab.id}
            title={`${cli.command} · model ${app.provider?.model ?? 'enpii settings'}`}
            onclick={() => void selectAgentPane(tab.id)}
          >{tab.label}</button>
          <button
            type="button"
            class="mr-1 grid size-7 place-items-center rounded-md text-[14px] leading-none text-studio-text-dim hover:bg-white/10 hover:text-studio-error"
            aria-label={`Close ${tab.label}`}
            title={`Close ${tab.label}`}
            onclick={(e) => {
              e.stopPropagation()
              void closeVendor(tab.id)
            }}
          ><Icon name="close" size={12} /></button>
        </div>
      {/if}
    {/each}
    <div class="relative ml-auto flex-none self-center">
      <Dropdown
        items={vendorMenuItems}
        label="Add vendor"
        align="end"
        onSelect={(id) => {
          if (id === '_none') return
          openVendorConfig(id as VendorKind)
        }}
      >
        {#snippet trigger({ open, toggle })}
          <button
            type="button"
            class="grid h-[26px] w-[30px] place-items-center rounded-lg border border-white/12 bg-white/5 text-studio-text-dim hover:border-studio-gold/45 hover:text-white"
            aria-label="Add vendor agent"
            aria-haspopup="menu"
            aria-expanded={open}
            title="Add vendor agent"
            onclick={(e) => {
              e.stopPropagation()
              toggle()
            }}
          ><Icon name="plus" size={14} /></button>
        {/snippet}
      </Dropdown>
    </div>
  </div>
  <div
    class="col-start-1 row-start-2 min-h-0 flex-col {agentPane !== 'enpii' ? 'flex' : 'hidden'}"
  >
    {#if vendorError}<div class="px-3 py-2 text-xs text-studio-error">{vendorError}</div>{/if}
    {#if vendorBusy && !vendorTerms.has(agentPane)}
      <div class="px-3 py-2 text-xs text-studio-text-dim">Starting…</div>
    {/if}
    <div class="min-h-0 flex-1 p-2" bind:this={vendorHost}></div>
  </div>
<div class="relative row-start-2 min-h-0 overflow-hidden {agentPane !== 'enpii' ? 'hidden' : ''}">
<div
  class="flex h-full min-h-0 flex-col gap-8 overflow-y-auto p-6 select-text"
  bind:this={stageEl}
  onscroll={onStageScroll}
  onpointerdown={onStagePointerDown}
  onpointerup={onStagePointerUp}
  onpointercancel={onStagePointerUp}
>
  {#if !app.activeProject}
    <div class="grid flex-1 place-items-center px-4 py-8 text-center text-studio-text-dim">
      <div>
        <div class="mx-auto mb-4 grid size-10 place-items-center rounded-lg bg-studio-purple text-sm font-bold text-white">e</div>
        <div class="mb-2 text-lg font-semibold text-studio-gold">enpii</div>
        <div class="mx-auto max-w-md text-[13px] leading-relaxed">Open a project from the left to start.</div>
      </div>
    </div>
  {:else if app.messages.length === 0}
    <div class="grid flex-1 place-items-center px-4 py-8 text-center text-studio-text-dim">
      <div>
        <div class="mx-auto mb-4 grid size-10 place-items-center rounded-lg bg-studio-purple text-sm font-bold text-white">e</div>
        <div class="mb-2 text-lg font-semibold text-studio-gold">enpii</div>
        <div class="mx-auto max-w-md text-[13px] leading-relaxed">
          Ask anything about <strong class="text-white">{app.projectLabel(app.activeProject)}</strong>.
          <br />
          Tools: list_dir · read_file · glob · grep · write_file · edit_file
        </div>
      </div>
    </div>
  {:else}
    {#if app.planMode}
      <div
        class="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-lg border border-studio-lavender/35 bg-studio-lavender/10 px-3.5 py-2.5 text-xs text-studio-text"
        role="status"
      >
        <strong class="text-[10px] uppercase tracking-wide text-studio-lavender">Plan mode</strong>
        <span>Writes, shell, git, MCP, and sub-agents blocked until exit_plan_mode</span>
      </div>
    {/if}
    {#if showTeamStrip}
      <div class="mb-3 flex flex-col gap-1.5" role="status" aria-label="Team activity">
        {#if app.teamBoard.length}
          <details class="rounded-md border border-border-subtle bg-studio-card/80 open:bg-studio-card" open>
            <summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim select-none [&::-webkit-details-marker]:hidden">
              <span class="text-studio-gold">Board</span>
              <span class="font-mono normal-case tracking-normal text-white/40">{app.teamBoard.length} open</span>
            </summary>
            <ul class="flex flex-col gap-0.5 px-2 pb-2">
              {#each app.teamBoard as t (t.id)}
                <li class="flex items-start gap-2 rounded px-1.5 py-1 text-[11px] text-studio-text">
                  <span class="mt-1 size-1.5 shrink-0 rounded-full {teamStatusDot(t.status)}"></span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium">{t.title}</div>
                    <div class="truncate font-mono text-[9px] text-white/35">
                      #{t.id.slice(0, 8)} · {t.status}{#if t.blockedBy.length} · blocked by {t.blockedBy.map((id) => id.slice(0, 6)).join(', ')}{/if}{#if t.progress != null} · {t.progress}%{/if}
                    </div>
                    {#if t.note}<div class="truncate text-[10px] text-studio-text-dim">{t.note}</div>{/if}
                  </div>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        {#if app.teamSubs.length}
          <details class="rounded-md border border-border-subtle bg-studio-card/80" open>
            <summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim select-none [&::-webkit-details-marker]:hidden">
              <span class="text-studio-lavender">Subs</span>
              <span class="font-mono normal-case tracking-normal text-white/40">{app.teamSubs.length}</span>
            </summary>
            <ul class="flex flex-col gap-0.5 px-2 pb-2">
              {#each app.teamSubs as s (s.id)}
                <li class="flex items-start gap-2 rounded px-1.5 py-1 text-[11px] text-studio-text">
                  <span class="mt-1 size-1.5 shrink-0 rounded-full {teamStatusDot(s.status)}"></span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium">{s.name || s.id} <span class="font-normal text-studio-text-dim">· {s.status}</span></div>
                    <div class="truncate text-[10px] text-studio-text-dim">{s.description}</div>
                    {#if s.worktreeBranch}<div class="truncate font-mono text-[9px] text-white/35">{s.worktreeBranch}</div>{/if}
                    {#if s.lastSummary}<div class="truncate text-[10px] text-white/45">{s.lastSummary.slice(0, 120)}</div>{/if}
                  </div>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        {#if app.teamMail.length}
          <details class="rounded-md border border-border-subtle bg-studio-card/80">
            <summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim select-none [&::-webkit-details-marker]:hidden">
              <span class="text-studio-success-bright">Mail</span>
              <span class="font-mono normal-case tracking-normal text-white/40">{app.teamMail.length}</span>
            </summary>
            <ul class="flex flex-col gap-0.5 px-2 pb-2">
              {#each app.teamMail as m (m.id)}
                <li class="rounded px-1.5 py-1 text-[11px] text-studio-text">
                  <div class="truncate font-mono text-[9px] text-white/40">{m.from} → {m.to}</div>
                  <div class="line-clamp-2 text-studio-text-dim">{m.content}</div>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
    {/if}
    {#if app.ask && !app.messages.some((m) => m.tool?.callId === app.ask?.toolCallId || m.tool?.callId === app.ask?.requestId)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
      <div
        class="mb-3 overflow-hidden rounded-lg border border-studio-purple/35 bg-studio-card outline-none"
        role="group"
        tabindex="0"
        onkeydown={(e) => onAskCardKeydown(e, app.ask!.requestId, app.ask!.options)}
      >
        <div class="flex items-center justify-between gap-3 border-b border-studio-lavender/20 bg-studio-lavender/10 px-4 py-2">
          <div class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-studio-lavender">
            <span>Question</span>
            {#if app.pendingAsks.length > 1}
              <span class="text-[9px] opacity-75">{app.pendingAsks.length} pending</span>
            {/if}
          </div>
          <span class="text-[10px] font-medium text-studio-text-dim">↑↓ Enter · Esc</span>
        </div>
        <div class="p-4">
          <p class="mb-3 text-[13px] leading-relaxed text-studio-text">{app.ask.question}</p>
          {#if app.ask.options?.length}
            <div class="mb-3 flex flex-col gap-1" role="listbox" aria-label="Choices">
              {#each app.ask.options as opt, oi (opt.label + oi)}
                <button
                  type="button"
                  role="option"
                  aria-selected={askFocusIndex === oi}
                  class="flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors {askFocusIndex === oi
                    ? 'border-studio-gold/50 bg-studio-gold/15'
                    : 'border-border-subtle bg-studio-dark/60 hover:border-studio-lavender/35 hover:bg-white/[0.04]'}"
                  onclick={() => submitAsk(app.ask!.requestId, opt.label)}
                  onmouseenter={() => (askFocusIndex = oi)}
                >
                  <div class="flex w-full items-center gap-2">
                    <span class="font-mono text-[10px] text-studio-text-dim">{oi + 1}.</span>
                    <span class="min-w-0 flex-1 text-[12px] font-semibold text-studio-text">{opt.label}</span>
                    {#if opt.recommended}
                      <span class="shrink-0 rounded bg-studio-gold/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-studio-gold">Recommended</span>
                    {/if}
                  </div>
                  {#if opt.description}
                    <p class="m-0 pl-5 text-[11px] leading-snug text-studio-text-dim">{opt.description}</p>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
          <div class="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="text"
              class="min-h-[42px] w-full rounded-lg border border-white/8 bg-black/35 px-3 py-2.5 text-[13px] text-studio-text outline-none focus:border-transparent focus:outline focus:outline-studio-lavender/55"
              placeholder="Type something…"
              value={askDraft(app.ask.requestId)}
              oninput={(e) => {
                askFocusIndex = -1
                setAskDraft(app.ask!.requestId, (e.currentTarget as HTMLInputElement).value)
              }}
              onkeydown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  onAskCardKeydown(e, app.ask!.requestId, app.ask!.options)
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (askFocusIndex >= 0 && app.ask?.options?.[askFocusIndex]) {
                    submitAsk(app.ask.requestId, app.ask.options[askFocusIndex]!.label)
                  } else {
                    submitAsk(app.ask!.requestId)
                  }
                }
              }}
            />
            <button
              type="button"
              class="rounded-lg bg-studio-gold px-4 py-3 text-sm font-bold text-studio-dark hover:brightness-95 disabled:opacity-45"
              disabled={!askDraft(app.ask.requestId).trim() && askFocusIndex < 0}
              onclick={() => {
                if (askFocusIndex >= 0 && app.ask?.options?.[askFocusIndex]) {
                  submitAsk(app.ask.requestId, app.ask.options[askFocusIndex]!.label)
                } else {
                  submitAsk(app.ask!.requestId)
                }
              }}
            >Submit</button>
          </div>
        </div>
      </div>
    {/if}
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-8 select-text" data-selectable>
      {#each groups as g, gi (g.kind === 'turn' ? `t-${gi}-${g.items[0]?.id}` : g.m.id)}
        {#if g.kind === 'user'}
          <div class="flex justify-end">
            <div
              class="flex max-w-[70%] flex-col gap-1.5 break-words rounded-lg border border-border-subtle bg-studio-card px-3 py-2.5 text-[13px] leading-relaxed select-text"
            >
              {#if g.m.text}<div class="whitespace-pre-wrap select-text">{g.m.text}</div>{/if}
            </div>
          </div>
        {:else if g.kind === 'system'}
          <div class="rounded-lg border border-dashed border-border-subtle p-3 text-center text-xs text-studio-text-dim select-text">
            {g.m.text}
          </div>
        {:else}
          <div class="flex items-start justify-center gap-4">
            <div
              class="grid size-8 shrink-0 place-items-center rounded-lg bg-studio-purple text-xs font-bold text-white"
            >
              e
            </div>
            <div class="flex min-w-0 max-w-[42rem] flex-1 flex-col gap-4">
              {#each g.items as m (m.id)}
                {#if m.role === 'assistant'}
                  {#if m.text}
                    <div class="break-words text-sm leading-relaxed text-studio-text-body select-text">
                      {@html renderMarkdown(m.text)}
                    </div>
                  {/if}
                {:else if m.role === 'tool' && m.tool}
                  {@const pending = pendingForTool(m.tool.callId)}
                  {@const askPending = pendingAskForTool(m.tool.callId)}
                  {#if askPending}
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
                    <div
                      class="overflow-hidden rounded-lg border border-studio-purple/35 bg-studio-card outline-none"
                      role="group"
                      tabindex="0"
                      onkeydown={(e) => onAskCardKeydown(e, askPending.requestId, askPending.options)}
                    >
                      <div class="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
                        <div class="flex items-center gap-2 text-[11px] font-semibold text-studio-lavender">
                          <span>Question</span>
                          {#if app.pendingAsks.length > 1}
                            <span class="text-[10px] text-studio-text-dim">{app.pendingAsks.length} pending</span>
                          {/if}
                        </div>
                        <span class="text-[10px] font-medium text-studio-text-dim">↑↓ Enter · Esc</span>
                      </div>
                      <div class="p-3">
                        <p class="mb-3 text-[13px] leading-relaxed text-studio-text">{askPending.question}</p>
                        {#if askPending.options?.length}
                          <div class="mb-2.5 flex flex-col gap-1" role="listbox" aria-label="Choices">
                            {#each askPending.options as opt, oi (opt.label + oi)}
                              <button
                                type="button"
                                role="option"
                                aria-selected={askFocusIndex === oi}
                                class="flex w-full flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors {askFocusIndex === oi
                                  ? 'border-studio-gold/50 bg-studio-gold/15'
                                  : 'border-border-subtle bg-studio-dark/60 hover:border-studio-lavender/35 hover:bg-white/[0.04]'}"
                                onclick={() => submitAsk(askPending.requestId, opt.label)}
                                onmouseenter={() => (askFocusIndex = oi)}
                              >
                                <div class="flex w-full items-center gap-2">
                                  <span class="font-mono text-[10px] text-studio-text-dim">{oi + 1}.</span>
                                  <span class="min-w-0 flex-1 text-[12px] font-semibold text-studio-text">{opt.label}</span>
                                  {#if opt.recommended}
                                    <span class="shrink-0 rounded bg-studio-gold/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-studio-gold">Recommended</span>
                                  {/if}
                                </div>
                                {#if opt.description}
                                  <p class="m-0 pl-5 text-[11px] leading-snug text-studio-text-dim">{opt.description}</p>
                                {/if}
                              </button>
                            {/each}
                          </div>
                        {/if}
                        <div class="grid grid-cols-[1fr_auto] gap-1.5">
                          <input
                            type="text"
                            class="min-h-9 w-full rounded-md border border-border-subtle bg-studio-dark px-2.5 py-2 text-[12px] text-studio-text outline-none focus:border-studio-purple/60"
                            placeholder="Type something…"
                            value={askDraft(askPending.requestId)}
                            oninput={(e) => {
                              askFocusIndex = -1
                              setAskDraft(askPending.requestId, (e.currentTarget as HTMLInputElement).value)
                            }}
                            onkeydown={(e) => {
                              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                onAskCardKeydown(e, askPending.requestId, askPending.options)
                                return
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                if (askFocusIndex >= 0 && askPending.options?.[askFocusIndex]) {
                                  submitAsk(askPending.requestId, askPending.options[askFocusIndex]!.label)
                                } else {
                                  submitAsk(askPending.requestId)
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            class="rounded-md bg-studio-gold px-3 py-2 text-[12px] font-semibold text-studio-dark hover:brightness-105 disabled:opacity-40"
                            disabled={!askDraft(askPending.requestId).trim() && askFocusIndex < 0}
                            onclick={() => {
                              if (askFocusIndex >= 0 && askPending.options?.[askFocusIndex]) {
                                submitAsk(askPending.requestId, askPending.options[askFocusIndex]!.label)
                              } else {
                                submitAsk(askPending.requestId)
                              }
                            }}
                          >Submit</button>
                        </div>
                      </div>
                    </div>
                  {:else if pending}
                    <!-- Inline placeholder only — real card is sticky above composer (no scroll to approve). -->
                    <div class="rounded-md border border-dashed border-studio-gold/25 bg-studio-gold/5 px-3 py-2 font-mono text-[11px] text-studio-gold/80">
                      Action required · see card above composer
                    </div>
                  {:else if isTerminalTool(m.tool.name)}
                    <details class="rounded-md border border-border-subtle bg-studio-dark font-mono text-xs {toolBorder(m.tool.status)}">
                      <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="size-1.5 shrink-0 rounded-full {toolDot(m.tool.status)}"></span>
                          <span class="shrink-0 font-semibold text-studio-success-bright">tool:{m.tool.name}</span>
                          <span class="truncate font-mono text-studio-text-dim select-text">{shellCommand(m)}</span>
                        </div>
                        <span class="shrink-0 text-[10px] text-studio-text-dim">{statusLabel(m, false)}</span>
                      </summary>
                      <div class="flex items-center gap-2 px-3 pb-2 font-mono text-[11px]">
                        <span class="shrink-0 text-studio-success-bright">$</span>
                        <code class="min-w-0 flex-1 truncate text-studio-text/90 select-text">{shellCommand(m)}</code>
                        {#if m.tool.preview && m.tool.status !== 'running'}
                          <button
                            type="button"
                            class="shrink-0 rounded border border-white/12 bg-white/4 px-2 py-0.5 text-[10px] text-studio-text-dim hover:border-white/28 hover:text-white"
                            title="Copy output"
                            onclick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              void copyToolOutput(m.tool?.preview ?? '')
                            }}
                          >
                            Copy
                          </button>
                        {/if}
                      </div>
                      {#if m.tool.preview && m.tool.status !== 'running'}
                        <pre class="mx-2 mb-2.5 max-h-70 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/6 bg-studio-shell-deep p-3 font-mono text-[11px] text-studio-success-out select-text">{m.tool.preview}</pre>
                      {:else if m.tool.status === 'running'}
                        <div class="mx-2 mb-2.5 rounded-lg border border-white/6 bg-studio-shell-deep p-3 font-mono text-[11px] text-studio-text-dim">Running…</div>
                      {:else}
                        <div class="mx-2 mb-2.5 rounded-lg border border-white/6 bg-studio-shell-deep p-3 font-mono text-[11px] text-studio-text-dim">No output</div>
                      {/if}
                    </details>
                  {:else}
                    <details class="rounded-md border border-border-subtle bg-studio-dark font-mono text-xs {toolBorder(m.tool.status)}" open={Boolean(m.tool.preview && isUnifiedDiff(m.tool.preview))}>
                      <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="size-1.5 shrink-0 rounded-full {toolDot(m.tool.status)}"></span>
                          <span class="shrink-0 font-semibold {toolAccent(m.tool.status)}">
                            {isTeamTool(m.tool.name) ? toolDisplayName(m.tool.name) : `tool:${m.tool.name}`}
                          </span>
                          <span class="truncate text-studio-text-dim select-text">{toolLabel(m)}</span>
                        </div>
                        <span class="shrink-0 text-[10px] text-studio-text-dim">{statusLabel(m, false)}</span>
                      </summary>
                      {#if m.tool.preview && m.tool.status !== 'running'}
                        {#if isUnifiedDiff(m.tool.preview)}
                          <div class="mx-2 mb-2.5 max-h-70 overflow-auto rounded-md border border-border-subtle bg-studio-diff-bg py-1 font-mono text-[11px] leading-snug select-text">
                            {#each m.tool.preview.split('\n') as line, li (`td-${m.id}-${li}`)}
                              <div class="min-h-[1.45em] whitespace-pre-wrap break-words px-2.5 {diffLineClass(line)}">{line || ' '}</div>
                            {/each}
                          </div>
                        {:else}
                          <pre class="m-0 max-h-40 overflow-auto px-3 pb-2.5 text-[11px] whitespace-pre-wrap break-words text-studio-text/75 select-text">{m.tool.preview}</pre>
                        {/if}
                      {:else if m.tool.status === 'running'}
                        <div class="px-3 pb-2.5 text-[11px] text-studio-text-dim">Running…</div>
                      {:else}
                        <div class="px-3 pb-2.5 text-[11px] text-studio-text-dim">No output</div>
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
    {#if app.run && !app.busy && (app.run.status === 'failed' || app.run.status === 'cancelled')}
      <div class="mx-auto mt-2 flex w-[calc(100%-32px)] max-w-3xl items-center justify-end gap-2 self-center">
        <button type="button" class="rounded-md bg-white/6 px-2.5 py-1 text-[11px] text-studio-text-dim hover:bg-white/10 hover:text-studio-text disabled:opacity-45" disabled={!lastUserPrompt()} onclick={() => void retryRun()}>Retry</button>
        <button type="button" class="rounded-md bg-white/6 px-2.5 py-1 text-[11px] text-studio-text-dim hover:bg-white/10 hover:text-studio-text" onclick={() => void continueRun()}>Continue</button>
      </div>
    {/if}
  {/if}
</div>
  {#if !stickBottom && app.messages.length > 0}
    <button
      type="button"
      class="absolute bottom-4 left-1/2 z-[5] grid size-8 -translate-x-1/2 place-items-center rounded-full border border-white/12 bg-studio-panel text-studio-text shadow-md hover:border-studio-gold/50 hover:bg-studio-card hover:text-studio-gold"
      title="Scroll to bottom"
      aria-label="Scroll to bottom"
      onclick={jumpToBottom}
    >
      <Icon name="arrow-down" size={14} class="text-current" />
    </button>
  {/if}
</div>

<footer class="row-start-3 shrink-0 px-4 pb-4 pt-1 {agentPane !== 'enpii' ? 'hidden' : ''}">
  {#if app.approval}
    {@const sticky = app.approval}
    {@const _sync = (syncApprovalEditDraft(sticky.requestId, sticky.args), 0)}
    <div class="mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-lg border border-studio-gold/40 bg-studio-card shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      <div class="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
        <div class="flex items-center gap-2 text-[11px] font-semibold text-studio-gold">
          <Icon name="alert" size={16} class="shrink-0 text-studio-gold" />
          <span>Action Required</span>
          {#if app.pendingApprovals.length > 1}
            <span class="rounded bg-studio-gold/15 px-1.5 py-0.5 font-mono text-[10px] text-studio-gold/90">{app.pendingApprovals.length}</span>
          {/if}
        </div>
        <span class="text-[10px] font-medium text-studio-text-dim">{approvalKind(sticky.name)}</span>
      </div>
      <div class="p-3">
        <p class="mb-2 text-[13px] leading-relaxed text-studio-text">
          <span class="font-semibold text-studio-lavender">enpii</span> wants to {approvalVerb(sticky.name)}
          <code class="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-studio-text">{approvalPath(sticky)}</code>
        </p>
        {#if sticky.preview && !approvalEditOpen}
          {#if isUnifiedDiff(sticky.preview)}
            <div class="mb-2 max-h-36 overflow-auto rounded-md border border-border-subtle bg-studio-diff-bg py-1 font-mono text-[11px] leading-snug">
              {#each sticky.preview.split('\n').slice(0, 80) as line, li (`sd-${li}`)}
                <div class="min-h-[1.45em] whitespace-pre-wrap break-words px-2.5 {diffLineClass(line)}">{line || ' '}</div>
              {/each}
            </div>
          {:else}
            <pre class="mb-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-studio-dark p-2.5 font-mono text-[11px] text-studio-text-dim">{sticky.preview}</pre>
          {/if}
        {/if}
        {#if approvalEditOpen}
          <label class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim" for="approval-edit-args">Tool args (JSON)</label>
          <textarea
            id="approval-edit-args"
            class="mb-1 max-h-40 min-h-[5.5rem] w-full resize-y rounded-md border border-border-subtle bg-studio-dark p-2.5 font-mono text-[11px] leading-snug text-studio-text outline-none focus:border-studio-gold/50"
            bind:value={approvalEditText}
            spellcheck="false"
          ></textarea>
          {#if approvalEditError}
            <p class="mb-2 text-[11px] text-red-400">{approvalEditError}</p>
          {/if}
        {/if}
        {#if approvalDenyOpen}
          <label class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim" for="approval-deny-reason">Deny reason (optional)</label>
          <input
            id="approval-deny-reason"
            class="mb-2 w-full rounded-md border border-border-subtle bg-studio-dark px-2.5 py-1.5 text-[12px] text-studio-text outline-none focus:border-studio-gold/50"
            bind:value={approvalDenyReason}
            placeholder="Shown to the model"
          />
        {/if}
        <div class="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-studio-text-dim hover:bg-white/[0.04] hover:text-studio-text {approvalEditOpen ? 'border-studio-gold/40 text-studio-gold' : ''}"
            onclick={() => {
              approvalEditOpen = !approvalEditOpen
              approvalEditError = ''
              if (approvalEditOpen && !approvalEditText.trim()) approvalEditText = prettyApprovalArgs(sticky.args)
            }}
          >{approvalEditOpen ? 'Hide args' : 'Edit args'}</button>
          <button
            type="button"
            class="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-studio-text-dim hover:bg-white/[0.04] hover:text-studio-text {approvalDenyOpen ? 'border-studio-gold/40 text-studio-gold' : ''}"
            onclick={() => { approvalDenyOpen = !approvalDenyOpen }}
          >{approvalDenyOpen ? 'Hide reason' : 'Deny reason'}</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="rounded-md border border-border-subtle px-3 py-2 text-[12px] font-medium text-studio-text hover:bg-white/[0.04]" onclick={() => denySticky(sticky.requestId)}>Deny</button>
          <button type="button" class="rounded-md bg-studio-gold px-3 py-2 text-[12px] font-semibold text-studio-dark hover:brightness-105" onclick={() => allowSticky(sticky.requestId)}>{approvalEditOpen ? 'Allow with edits' : approvalButton(sticky.name)}</button>
          <button type="button" class="col-span-2 rounded-md border border-studio-gold/30 bg-studio-gold/10 px-3 py-2 text-[12px] font-semibold text-studio-gold hover:bg-studio-gold/15" title="Auto-allow this action kind for the rest of the session (siblings keep original args)" onclick={() => allowSticky(sticky.requestId, 'session')}>Allow for session</button>
        </div>
      </div>
    </div>
  {/if}
  <div
    class="composer-inner relative flex flex-col gap-3 rounded-lg border border-border-subtle bg-studio-dark p-3 transition-colors duration-100 focus-within:border-studio-purple/50"
    role="group"
    aria-label="Message composer"
  >
    {#if app.draftPlan?.status === 'draft'}
      <div class="mb-1 rounded-md border border-studio-lavender/30 bg-studio-purple/10 px-2.5 py-2">
        <div class="mb-1 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-studio-lavender">Draft plan</div>
            <div class="truncate text-[12px] text-studio-text">{app.draftPlan.title}</div>
            <div class="truncate font-mono text-[9px] text-white/35">{app.draftPlan.relPath}</div>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <button
              type="button"
              class="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-studio-text-dim hover:bg-white/5"
              onclick={() => void rejectDiskPlan(app.draftPlan?.id).catch((e) => app.notify('error', 'Reject failed', e instanceof Error ? e.message : String(e)))}
            >Reject</button>
            <button
              type="button"
              class="rounded-md bg-studio-gold px-2 py-1 text-[11px] font-semibold text-studio-dark hover:brightness-105"
              onclick={() => void approveDiskPlan(app.draftPlan?.id).then(() => void sendPrompt('Plan approved. Execute the approved plan steps. Do not re-plan unless blocked.')).catch((e) => app.notify('error', 'Approve failed', e instanceof Error ? e.message : String(e)))}
            >Approve & run</button>
          </div>
        </div>
        <ol class="m-0 list-decimal space-y-0.5 pl-4 text-[11px] text-studio-text-dim">
          {#each app.draftPlan.steps as step, si (si)}
            <li>
              <span class="text-studio-text">{step.title}</span>
              {#if step.detail}<span class="text-white/40"> — {step.detail}</span>{/if}
            </li>
          {/each}
        </ol>
      </div>
    {/if}
    {#if app.planMode}
      <div class="mb-1 flex flex-wrap items-center gap-2 text-[10px]">
        <span class="rounded-full border border-studio-lavender/40 bg-studio-purple/15 px-2 py-0.5 font-semibold text-studio-lavender">Plan mode · writes blocked</span>
      </div>
    {/if}
    {#if app.promptQueue.length}
      <div class="mb-1 flex flex-col gap-1 rounded-md border border-dashed border-studio-gold/25 bg-studio-gold/5 px-2.5 py-1.5">
        <div class="text-[10px] font-semibold text-studio-gold/90">
          Queue · {app.promptQueue.length} waiting
        </div>
        {#each app.promptQueue as q, qi (q.id)}
          <div class="flex items-start gap-2 text-[11px] text-studio-text-dim">
            <span class="shrink-0 tabular-nums text-white/35">{qi + 1}.</span>
            <span class="min-w-0 flex-1 truncate">{q.displayText ?? q.text}</span>
            <button
              type="button"
              class="shrink-0 text-[10px] text-studio-error-soft hover:underline"
              onclick={() => app.removeQueuedPrompt(q.id)}
            >Remove</button>
          </div>
        {/each}
      </div>
    {/if}
    <textarea
      class="min-h-[60px] w-full resize-none bg-transparent text-sm leading-relaxed text-studio-text outline-none placeholder:text-studio-text-dim disabled:opacity-45"
      rows="3"
      bind:this={composerEl}
      placeholder={app.activeProject
        ? app.busy
          ? 'Agent busy — send queues until done…'
          : 'Message the agent… (Use @ to reference files)'
        : 'Open a project first'}
      bind:value={app.composer}
      onkeydown={onKeydown}
      oninput={() => {
        // Typing while browsing history exits browse mode (keep text).
        if (historyIndex >= 0) {
          historyIndex = -1
          historyDraft = ''
        }
        onComposerInput()
      }}
      onclick={syncMentionCaret}
      onkeyup={syncMentionCaret}
      onselect={syncMentionCaret}
      onpaste={onPaste}
      disabled={!app.activeProject}
      title="↑/↓ recall previous prompts"
    ></textarea>
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-studio-text-dim">
        <SmartSelect
          value={app.composerMode}
          options={COMPOSER_MODES.map((m) => ({
            value: m.value,
            label: t(m.labelKey),
            description: t(m.descriptionKey),
          }))}
          ariaLabel="Composer mode"
          title="Shift+Tab: cycle composer mode"
          class="min-w-0 w-auto [&>button]:min-h-7 [&>button]:w-auto [&>button]:rounded-lg [&>button]:border-studio-purple/30 [&>button]:bg-studio-purple/15 [&>button]:px-2.5 [&>button]:py-1 [&>button]:text-[11px] [&>button]:text-studio-lavender-muted"
          onChange={(value) => void changeComposerMode(value)}
        />
        <button
          type="button"
          class="text-studio-text-dim hover:text-white disabled:opacity-45"
          title="Attach files"
          aria-label="Attach files"
          onclick={() => void attachFiles()}
        >
          <Icon name="paperclip" size={20} />
        </button>
        {#if app.attachments.length}
          <span
            class="whitespace-nowrap text-[8px] text-white/30"
            title={app.attachments.map((f) => f.name).join(', ')}
          >
            {app.attachments.length} file{app.attachments.length === 1 ? '' : 's'} · ~{attachmentTokens().toLocaleString()} tok
          </span>
        {/if}
        {#if app.busy && liveElapsed}
          <span class="tabular-nums text-[10px] text-studio-gold/75" title="Elapsed this turn">{liveElapsed}</span>
        {/if}
      </div>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-md bg-studio-gold px-3 py-1.5 text-[12px] font-semibold text-studio-dark hover:brightness-105 disabled:opacity-40 {app.busy
          ? 'studio-signal'
          : ''}"
        onclick={() => (app.busy ? void stopAgentTurn() : void onSend())}
        disabled={!app.activeProject || (!app.busy && !app.composer.trim() && !app.attachments.length)}
      >
        {app.busy ? 'Stop' : app.promptQueue.length ? 'Queue' : 'Send'}
        <Icon name={app.busy ? 'stop' : 'send'} size={14} />
      </button>
    </div>
    {#if activeMention && (mentionResults.length > 0 || mentionLoading)}
      <div
        class="absolute bottom-[calc(100%+8px)] left-3 z-10 max-h-56 w-[min(420px,calc(100%-24px))] overflow-y-auto rounded-lg border border-border-subtle bg-studio-popover p-1"
        role="listbox"
        aria-label="File references"
      >
        {#if mentionLoading && mentionResults.length === 0}
          <div class="px-2.5 py-2 text-[11px] text-studio-text-dim">Searching…</div>
        {:else}
          {#each mentionResults as path, index (path)}
            <button
              type="button"
              class="block w-full rounded-md px-2.5 py-2 text-left {index === mentionActive
                ? 'bg-studio-purple/20'
                : 'hover:bg-studio-purple/20'}"
              onclick={() => applyMention(path)}
              onmouseenter={() => (mentionActive = index)}
            >
              <span class="flex flex-col gap-0.5">
                <strong class="font-mono text-[10px] text-studio-text">{mentionLabel(path)}</strong>
                <small class="text-[9px] text-studio-text-dim"
                  >{path === '__selection__' ? 'Current Code selection' : 'Project file'}</small
                >
              </span>
            </button>
          {/each}
        {/if}
      </div>
    {:else if slashSuggestions.length > 0}
      <div
        class="absolute bottom-[calc(100%+8px)] left-3 z-10 max-h-56 w-[min(420px,calc(100%-24px))] overflow-y-auto rounded-lg border border-border-subtle bg-studio-popover p-1"
        role="listbox"
        aria-label="Slash commands"
      >
        {#each slashSuggestions as command, index (command.name)}
          <button
            type="button"
            class="block w-full rounded-md px-2.5 py-2 text-left {index === slashActive
              ? 'bg-studio-purple/20'
              : 'hover:bg-studio-purple/20'}"
            onclick={() => {
              app.composer = `${command.name} `
              composerEl?.focus()
            }}
            onmouseenter={() => (slashActive = index)}
          >
            <span class="flex flex-col gap-0.5">
              <strong class="font-mono text-[10px] text-studio-text">{command.usage}</strong>
              <small class="text-[9px] text-studio-text-dim">{command.description}</small>
            </span>
          </button>
        {/each}
      </div>
    {/if}
    {#if attachmentPreviewId}
      {@const preview = app.attachments.find((file) => file.id === attachmentPreviewId)}
      {#if preview}
        <section
          class="absolute bottom-[74px] left-3 z-16 w-[min(500px,calc(100%-24px))] overflow-hidden rounded-lg border border-border-subtle bg-studio-popover"
        >
          <header class="flex items-center gap-2 border-b border-white/7 px-2.5 py-2">
            <strong class="min-w-0 truncate text-[10px] text-studio-text">{preview.name}</strong>
            <span class="ml-auto whitespace-nowrap text-[8px] text-studio-text-dim">
              {preview.kind} · {(preview.size / 1024).toFixed(1)} KB{#if preview.images?.length}
                · {preview.images.length} image{/if}
            </span>
            <button
              type="button"
              class="px-0.5 text-sm text-studio-text-dim hover:text-studio-text"
              aria-label="Close attachment preview"
              onclick={() => (attachmentPreviewId = null)}><Icon name="close" size={12} /></button
            >
          </header>
          {#if preview.error}
            <div class="max-h-60 overflow-auto p-2.5 font-mono text-[9px] text-studio-amber whitespace-pre-wrap break-words">
              {preview.error}
            </div>
          {:else}
            <pre
              class="m-0 max-h-60 overflow-auto p-2.5 font-mono text-[9px] text-white/50 whitespace-pre-wrap break-words"
              >{preview.content.slice(0, 4_000) || '[vision image]'}</pre
            >
          {/if}
        </section>
      {/if}
    {/if}
  </div>
</footer>
</div>

<ConfirmDialog
  open={checkpointConfirm != null}
  title={checkpointConfirm?.kind === 'retry'
    ? t('agent.checkpoint.retryTitle')
    : checkpointConfirm?.path
      ? t('agent.checkpoint.revertFile', { path: checkpointConfirm.path })
      : t('agent.checkpoint.revertTurn')}
  message={checkpointConfirm?.kind === 'retry'
    ? t('agent.checkpoint.revertRetry')
    : checkpointConfirm?.path
      ? t('agent.checkpoint.revertFileMsg')
      : t('agent.checkpoint.revertTurnMsg')}
  cancelLabel={t('common.cancel')}
  confirmLabel={checkpointConfirm?.kind === 'retry' ? t('common.retry') : t('agent.checkpoint.revert')}
  danger
  onCancel={() => (checkpointConfirm = null)}
  onConfirm={() => void confirmCheckpointAction()}
/>

<Modal
  open={vendorConfigOpen}
  title={vendorConfigKind
    ? `Launch ${VENDOR_CLIS.find((c) => c.id === vendorConfigKind)?.label ?? vendorConfigKind}`
    : 'Launch vendor'}
  size="md"
  onClose={closeVendorConfig}
>
  <div class="flex flex-col gap-3">
    <SmartSelect
      label="Model"
      bind:value={vendorConfig.model}
      options={vendorModelOptions}
      disabled={!vendorModelOptions.length}
    />
  </div>
  {#snippet footer()}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={closeVendorConfig}>{t('common.cancel')}</Button>
      <Button variant="primary" size="sm" loading={vendorBusy} onclick={() => void confirmVendorConfig()}>Launch</Button>
    </div>
  {/snippet}
</Modal>

<svelte:window onkeydown={onWindowKeydown} />
