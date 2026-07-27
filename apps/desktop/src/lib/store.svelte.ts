export type Mode = 'agent' | 'code' | 'terminal' | 'git' | 'browser'
export type ComposerMode = 'manual' | 'accept_edits' | 'plan' | 'full_auto'
export type KeybindingAction = 'palette' | 'settings' | 'notifications' | `mode.${Mode}`
export type PermissionMode = 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
export type ProviderDialect = 'openai' | 'anthropic'

/** Single source — TopNav / palette / keybindings. */
export const MODES: readonly { id: Mode; label: string; openLabel: string; shortcut: string }[] = [
  { id: 'agent', label: 'Agent', openLabel: 'Open Agent', shortcut: 'Mod+1' },
  { id: 'code', label: 'Code', openLabel: 'Open Code', shortcut: 'Mod+2' },
  { id: 'terminal', label: 'Terminal', openLabel: 'Open Terminal', shortcut: 'Mod+3' },
  { id: 'git', label: 'Git', openLabel: 'Open Git', shortcut: 'Mod+4' },
  { id: 'browser', label: 'Browser', openLabel: 'Open Browser', shortcut: 'Mod+5' },
] as const

export const COMPOSER_MODES: readonly {
  value: ComposerMode
  label: string
  description: string
  permission: PermissionMode
}[] = [
  { value: 'manual', label: 'Manual', description: 'Read-only agent', permission: 'read_only' },
  { value: 'accept_edits', label: 'Accept Edits', description: 'Ask before changes', permission: 'ask' },
  { value: 'plan', label: 'Plan', description: 'Plan without edits', permission: 'read_only' },
  { value: 'full_auto', label: 'Full Auto', description: 'Allow all actions', permission: 'full' },
] as const

export const PERMISSION_MODES: readonly {
  value: PermissionMode
  label: string
  description: string
}[] = [
  { value: 'ask', label: 'Ask', description: 'Confirm writes (default)' },
  { value: 'read_only', label: 'Read only', description: 'Block all mutations' },
  { value: 'autopilot_workspace', label: 'Autopilot workspace', description: 'Auto-allow writes in jail' },
  { value: 'full', label: 'Full', description: 'Auto all — still jail + deny globs' },
] as const

export const PROVIDER_DIALECTS: readonly {
  value: ProviderDialect
  label: string
  description: string
}[] = [
  { value: 'openai', label: 'OpenAI', description: 'Chat Completions + tools' },
  { value: 'anthropic', label: 'Anthropic', description: 'Messages API shape' },
] as const

export const GLOBAL_ACTIONS: readonly { id: Exclude<KeybindingAction, `mode.${Mode}`>; label: string; shortcut: string }[] = [
  { id: 'palette', label: 'Command Palette', shortcut: 'Mod+K' },
  { id: 'settings', label: 'Settings', shortcut: 'Mod+,' },
  { id: 'notifications', label: 'Notifications', shortcut: 'Mod+Shift+N' },
] as const

export const defaultKeybindings: Record<KeybindingAction, string> = {
  ...Object.fromEntries(GLOBAL_ACTIONS.map((a) => [a.id, a.shortcut])),
  ...Object.fromEntries(MODES.map((m) => [`mode.${m.id}`, m.shortcut])),
} as Record<KeybindingAction, string>

function loadKeybindings(): Record<KeybindingAction, string> {
  try {
    const saved = JSON.parse(localStorage.getItem('enpiistudio.keybindings') ?? '{}') as Partial<Record<KeybindingAction, string>>
    return { ...defaultKeybindings, ...saved }
  } catch {
    return { ...defaultKeybindings }
  }
}

export function keybindingFromEvent(event: KeyboardEvent): string | null {
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null
  const modifiers = [event.metaKey || event.ctrlKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean)
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null
  return [...modifiers, key].join('+')
}

export function matchesKeybinding(event: KeyboardEvent, binding: string): boolean {
  return keybindingFromEvent(event) === binding
}

export interface ProjectLayout {
  sidebarWidth: number
  inspectorWidth: number
}

/** Shell column floors / caps (px). */
export const LAYOUT_MIN = {
  sidebar: 200,
  inspector: 300,
  center: 360,
} as const
export const LAYOUT_MAX = {
  sidebar: 420,
  inspector: 520,
} as const
export const LAYOUT_DEFAULT = {
  sidebar: 256,
  inspector: 320,
} as const

/** Shell chrome: pad 8×2 + gap 8×2. */
const LAYOUT_CHROME = 32

/**
 * Heal widths left by old git 2-col / minmax collapse.
 * Anything below the healthy default for inspector was almost always corruption, not user choice.
 */
function healRail(raw: number, fallback: number, min: number): number {
  if (!Number.isFinite(raw)) return fallback
  // Pre-fix floors were 180/220 — treat residual mins as broken.
  if (raw < min) return fallback
  if (raw < fallback * 0.85 && raw <= 260) return fallback
  return raw
}

export function clampProjectLayout(
  patch: Partial<ProjectLayout>,
  current?: ProjectLayout,
  opts?: { viewportWidth?: number },
): ProjectLayout {
  const patchSide = patch.sidebarWidth
  const patchInsp = patch.inspectorWidth
  let side = Number(
    patchSide ?? healRail(Number(current?.sidebarWidth), LAYOUT_DEFAULT.sidebar, LAYOUT_MIN.sidebar),
  )
  let insp = Number(
    patchInsp ?? healRail(Number(current?.inspectorWidth), LAYOUT_DEFAULT.inspector, LAYOUT_MIN.inspector),
  )
  if (!Number.isFinite(side)) side = LAYOUT_DEFAULT.sidebar
  if (!Number.isFinite(insp)) insp = LAYOUT_DEFAULT.inspector
  // Explicit drag/patch still heals absurd lows.
  if (patchSide === undefined) side = healRail(side, LAYOUT_DEFAULT.sidebar, LAYOUT_MIN.sidebar)
  if (patchInsp === undefined) insp = healRail(insp, LAYOUT_DEFAULT.inspector, LAYOUT_MIN.inspector)
  side = Math.min(LAYOUT_MAX.sidebar, Math.max(LAYOUT_MIN.sidebar, side))
  insp = Math.min(LAYOUT_MAX.inspector, Math.max(LAYOUT_MIN.inspector, insp))
  const avail =
    (opts?.viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1400)) - LAYOUT_CHROME
  const budget = Math.max(LAYOUT_MIN.sidebar + LAYOUT_MIN.center + LAYOUT_MIN.inspector, avail)
  if (side + insp > budget - LAYOUT_MIN.center) {
    const railBudget = Math.max(LAYOUT_MIN.sidebar + LAYOUT_MIN.inspector, budget - LAYOUT_MIN.center)
    // Prefer keeping inspector readable — trim sidebar first.
    side = Math.min(side, Math.max(LAYOUT_MIN.sidebar, railBudget - LAYOUT_MIN.inspector))
    insp = Math.min(insp, Math.max(LAYOUT_MIN.inspector, railBudget - side))
    if (side + insp > railBudget) {
      side = Math.max(LAYOUT_MIN.sidebar, railBudget - insp)
    }
  }
  return { sidebarWidth: Math.round(side), inspectorWidth: Math.round(insp) }
}

export interface Project {
  id: string
  name: string
  path: string
  pinned?: boolean
  layout?: ProjectLayout
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  ts: number
  /** Display-only chips for user turns (not re-sent). */
  attachments?: { name: string; kind?: 'text' | 'image' }[]
  tool?: {
    callId: string
    name: string
    path?: string
    args?: string
    status: 'running' | 'ok' | 'error'
    summary?: string
    preview?: string
  }
}

export interface ComposerAttachment {
  id: string
  name: string
  /** Absolute source path when known (dedupe key). */
  path?: string
  size: number
  kind: 'text' | 'image'
  content: string
  images?: { name: string; mime: string; dataUrl: string }[]
  error?: string
}

export interface SessionInfo {
  id: string
  title: string
  status: string
  model: string
  projectRoot?: string
  baseProjectRoot?: string
  worktreeBranch?: string
  messageCount?: number
  sizeBytes?: number
  usage?: TokenUsage
  /** false = skip durable memory inject (default true). */
  loadMemory?: boolean
  /** Live from sidecar when session is mid-run. */
  busy?: boolean
  worktree?: boolean
}

export interface AgentBoardItem {
  id: string
  title: string
  status: string
  busy: boolean
  worktreeBranch?: string
  projectRoot?: string
  model?: string
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface ApprovalRequest {
  requestId: string
  sessionId: string
  toolCallId: string
  name: string
  summary: string
  preview: string
  args?: string
}

/** Mid-run ask_user question from agent. */
export interface AskUserRequest {
  requestId: string
  sessionId: string
  toolCallId: string
  question: string
  options?: string[]
  summary: string
}

export interface DiffItem {
  id: string
  name: string
  path?: string
  summary: string
  preview: string
  ts: number
}

export interface AgentCheckpoint {
  id: string
  createdAt: string
  prompt?: string
  files: { path: string; existed: boolean; size: number }[]
}

export interface RunCheck {
  command: string
  ok: boolean
  output: string
}

export interface RunTelemetry {
  runId?: string
  status: string
  round: number
  toolCount?: number
  maxRounds?: number
  maxTokens?: number
  maxRuntimeMs?: number
  maxRepairAttempts?: number
  repairAttempts: number
  lastEvent?: string
  error?: string
  usage: TokenUsage | null
  checks: RunCheck[]
  verifier?: {
    passed: boolean
    summary: string
    failures: string[]
  }
  context?: {
    fingerprint: string
    hasAgentInstructions: boolean
    hasMemory?: boolean
    skillCount: number
    loadedSkills: string[]
  }
  retries: number
  circuit?: 'open' | 'half_open' | 'closed'
  tasks: { id: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed'; detail?: string; startedAt?: string; finishedAt?: string; toolCount?: number }[]
}

export interface ApprovalRecord {
  requestId?: string
  toolCallId?: string
  name: string
  summary: string
  preview?: string
  args?: string
  decision: 'allow' | 'deny'
  ts: number
}

export interface AppNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  detail?: string
  ts: number
  read: boolean
  visible: boolean
}

function projectId(p: string): string {
  return btoa(unescape(encodeURIComponent(p))).replace(/=+$/, '')
}

function projectPathKey(p: string): string {
  return p.replace(/[\\/]+$/, '')
}

function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => {
    const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    if (pin) return pin
    return a.name.localeCompare(b.name)
  })
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem('enpiistudio.projects')
    if (!raw) return []
    const parsed = JSON.parse(raw) as Project[]
    const migrated = sortProjects([...new Map(parsed
      .filter((project) => typeof project?.path === 'string' && project.path.trim())
      .map((project) => {
        const path = project.path
        const layout = clampProjectLayout({}, project.layout)
        return [projectPathKey(path), {
          ...project,
          id: projectId(path),
          pinned: Boolean(project.pinned),
          layout,
        }]
      })).values()])
    if (JSON.stringify(migrated) !== JSON.stringify(parsed)) {
      localStorage.setItem('enpiistudio.projects', JSON.stringify(migrated))
    }
    return migrated
  } catch {
    return []
  }
}

function saveProjects(list: Project[]): void {
  localStorage.setItem('enpiistudio.projects', JSON.stringify(list))
}

interface ProjectWorkspace {
  session: SessionInfo | null
  messages: ChatMessage[]
  composer: string
  usage: TokenUsage | null
  run: RunTelemetry | null
  diffs: DiffItem[]
  checkpoints: AgentCheckpoint[]
  approvals: ApprovalRecord[]
  attachments: ComposerAttachment[]
  busy?: boolean
  streamingId?: string | null
  pendingApprovals?: ApprovalRequest[]
}

/** Live UI state for one agent session (supports concurrent background runs). */
export interface LiveSessionState {
  messages: ChatMessage[]
  composer: string
  attachments: ComposerAttachment[]
  usage: TokenUsage | null
  run: RunTelemetry | null
  streamingId: string | null
  pendingApprovals: ApprovalRequest[]
  pendingAsks?: AskUserRequest[]
  planMode?: boolean
  approvals: ApprovalRecord[]
  diffs: DiffItem[]
  checkpoints: AgentCheckpoint[]
  busy: boolean
  status: string
}

class AppState {
  mode = $state<Mode>('agent')
  projects = $state<Project[]>(loadProjects())
  activeProjectId = $state<string | null>(null)
  session = $state<SessionInfo | null>(null)
  sessionList = $state<SessionInfo[]>([])
  messages = $state<ChatMessage[]>([])
  composer = $state('')
  attachments = $state<ComposerAttachment[]>([])
  composerMode = $state<ComposerMode>('accept_edits')
  enpiiStatus = $state<'unknown' | 'ok' | 'error'>('unknown')
  enpiiInfo = $state<string>('')
  logs = $state<string[]>([])
  busy = $state(false)
  usage = $state<TokenUsage | null>(null)
  run = $state<RunTelemetry | null>(null)
  streamingId = $state<string | null>(null)
  /** Active approval queue (multi pending). `approval` = head for compat. */
  pendingApprovals = $state<ApprovalRequest[]>([])
  /** Active ask_user queue. */
  pendingAsks = $state<AskUserRequest[]>([])
  /** Session-level plan mode flag (from enter_plan_mode events). */
  planMode = $state(false)
  get approval(): ApprovalRequest | null {
    return this.pendingApprovals[0] ?? null
  }
  set approval(value: ApprovalRequest | null) {
    if (!value) {
      this.pendingApprovals = []
      return
    }
    const rest = this.pendingApprovals.filter((a) => a.requestId !== value.requestId)
    this.pendingApprovals = [value, ...rest]
  }
  get ask(): AskUserRequest | null {
    return this.pendingAsks[0] ?? null
  }
  diffs = $state<DiffItem[]>([])
  checkpoints = $state<AgentCheckpoint[]>([])
  approvals = $state<ApprovalRecord[]>([])
  codePath = $state<string | null>(null)
  codeLine = $state<number | null>(null)
  /** Live Code-mode selection for @selection refs. */
  codeSelection = $state<{
    path: string
    startLine: number
    endLine: number
    text: string
  } | null>(null)
  settingsOpen = $state(false)
  notificationsOpen = $state(false)
  notifications = $state<AppNotification[]>([])
  keybindings = $state<Record<KeybindingAction, string>>(loadKeybindings())
  provider = $state<{
    baseUrl: string
    model: string
    dialect: ProviderDialect
    permissionMode: PermissionMode
    denyGlobs?: string[]
    hasKey: boolean
    envOverrides: {
      baseUrl: boolean
      apiKey: boolean
      model: boolean
      dialect: boolean
    }
  } | null>(null)

  /** In-memory chat cache per project (disk is source of truth via enpii). */
  private workspaces = new Map<string, ProjectWorkspace>()
  /** Live concurrent session runtimes (survive switch while agent runs). */
  liveSessions = new Map<string, LiveSessionState>()
  /** Busy flags for background sessions (Inspector badges). */
  sessionBusy = $state<Record<string, boolean>>({})

  get activeProject(): Project | null {
    return this.projects.find((p) => p.id === this.activeProjectId) ?? null
  }

  emptyLive(status = 'idle'): LiveSessionState {
    return {
      messages: [],
      composer: '',
      attachments: [],
      usage: null,
      run: null,
      streamingId: null,
      pendingApprovals: [],
      pendingAsks: [],
      planMode: false,
      approvals: [],
      diffs: [],
      checkpoints: [],
      busy: false,
      status,
    }
  }

  /** Snapshot active UI fields into live map for sessionId. */
  stashLiveSession(sessionId: string | null | undefined = this.session?.id): void {
    if (!sessionId) return
    this.liveSessions.set(sessionId, {
      messages: this.messages,
      composer: this.composer,
      attachments: this.attachments,
      usage: this.usage,
      run: this.run,
      streamingId: this.streamingId,
      pendingApprovals: this.pendingApprovals,
      pendingAsks: this.pendingAsks,
      planMode: this.planMode,
      approvals: this.approvals,
      diffs: this.diffs,
      checkpoints: this.checkpoints,
      busy: this.busy,
      status: this.session?.status ?? 'idle',
    })
    this.sessionBusy = { ...this.sessionBusy, [sessionId]: this.busy }
  }

  /** Apply live map entry onto active UI. */
  restoreLiveSession(sessionId: string): boolean {
    const live = this.liveSessions.get(sessionId)
    if (!live) return false
    this.messages = live.messages
    this.composer = live.composer
    this.attachments = live.attachments
    this.usage = live.usage
    this.run = live.run
    this.streamingId = live.streamingId
    this.pendingApprovals = live.pendingApprovals
    this.pendingAsks = live.pendingAsks ?? []
    this.planMode = live.planMode ?? false
    this.approvals = live.approvals
    this.diffs = live.diffs
    this.checkpoints = live.checkpoints
    this.busy = live.busy
    return true
  }

  getLive(sessionId: string): LiveSessionState {
    let live = this.liveSessions.get(sessionId)
    if (!live) {
      live = this.emptyLive()
      this.liveSessions.set(sessionId, live)
    }
    return live
  }

  /** Patch a (possibly background) session runtime. */
  patchLive(sessionId: string, patch: Partial<LiveSessionState>): void {
    const live = { ...this.getLive(sessionId), ...patch }
    this.liveSessions.set(sessionId, live)
    if (typeof patch.busy === 'boolean') {
      this.sessionBusy = { ...this.sessionBusy, [sessionId]: patch.busy }
    }
    if (this.session?.id === sessionId) {
      if (patch.messages) this.messages = patch.messages
      if (patch.composer !== undefined) this.composer = patch.composer
      if (patch.attachments) this.attachments = patch.attachments
      if (patch.usage !== undefined) this.usage = patch.usage
      if (patch.run !== undefined) this.run = patch.run
      if (patch.streamingId !== undefined) this.streamingId = patch.streamingId
      if (patch.pendingApprovals) this.pendingApprovals = patch.pendingApprovals
      if (patch.approvals) this.approvals = patch.approvals
      if (patch.diffs) this.diffs = patch.diffs
      if (patch.checkpoints) this.checkpoints = patch.checkpoints
      if (typeof patch.busy === 'boolean') this.busy = patch.busy
      if (patch.status) this.session = { ...this.session, status: patch.status }
    }
  }

  setSessionBusy(sessionId: string, busy: boolean): void {
    this.sessionBusy = { ...this.sessionBusy, [sessionId]: busy }
    const live = this.getLive(sessionId)
    live.busy = busy
    this.liveSessions.set(sessionId, live)
    if (this.session?.id === sessionId) this.busy = busy
  }

  isSessionBusy(sessionId: string): boolean {
    if (this.session?.id === sessionId) return this.busy
    return Boolean(this.sessionBusy[sessionId] ?? this.liveSessions.get(sessionId)?.busy)
  }

  mutateLive(sessionId: string, mutator: (live: LiveSessionState) => void): void {
    const live = this.getLive(sessionId)
    mutator(live)
    this.liveSessions.set(sessionId, live)
    this.sessionBusy = { ...this.sessionBusy, [sessionId]: live.busy }
    if (this.session?.id === sessionId) {
      this.messages = live.messages
      this.composer = live.composer
      this.attachments = live.attachments
      this.usage = live.usage
      this.run = live.run
      this.streamingId = live.streamingId
      this.pendingApprovals = live.pendingApprovals
      this.approvals = live.approvals
      this.diffs = live.diffs
      this.checkpoints = live.checkpoints
      this.busy = live.busy
      if (live.status) this.session = { ...this.session, status: live.status }
    }
  }

  setMode(mode: Mode): void {
    this.mode = mode
  }

  openCodeFile(file: string): void {
    const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
    const target = normalized.match(/^(.*?):(\d+)(?::\d+)?$/)
    this.codePath = target?.[1] ?? normalized
    this.codeLine = target?.[2] ? Number(target[2]) : null
    this.mode = 'code'
  }

  private stashActive(): void {
    if (!this.activeProjectId) return
    this.stashLiveSession()
    this.workspaces.set(this.activeProjectId, {
      session: this.session,
      messages: this.messages,
      composer: this.composer,
      usage: this.usage,
      run: this.run,
      diffs: this.diffs,
      checkpoints: this.checkpoints,
      approvals: this.approvals,
      attachments: this.attachments,
      busy: this.busy,
      streamingId: this.streamingId,
      pendingApprovals: this.pendingApprovals,
    })
  }

  private restore(id: string): void {
    const ws = this.workspaces.get(id)
    this.session = ws?.session ?? null
    if (this.session?.id && this.restoreLiveSession(this.session.id)) return
    this.messages = ws?.messages ?? []
    this.composer = ws?.composer ?? ''
    this.usage = ws?.usage ?? null
    this.run = ws?.run ?? null
    this.diffs = ws?.diffs ?? []
    this.checkpoints = ws?.checkpoints ?? []
    this.approvals = ws?.approvals ?? []
    this.attachments = ws?.attachments ?? []
    this.streamingId = ws?.streamingId ?? null
    this.pendingApprovals = ws?.pendingApprovals ?? []
    this.busy = ws?.busy ?? false
  }

  addProject(folderPath: string): Project {
    const name = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath
    const normalizedPath = projectPathKey(folderPath)
    const id = projectId(normalizedPath)
    const existing = this.projects.find((p) => projectPathKey(p.path) === normalizedPath)
    if (existing) {
      this.selectProject(existing.id)
      return existing
    }
    const project: Project = {
      id,
      name,
      path: folderPath,
      layout: { sidebarWidth: LAYOUT_DEFAULT.sidebar, inspectorWidth: LAYOUT_DEFAULT.inspector },
    }
    this.projects = sortProjects([project, ...this.projects])
    saveProjects(this.projects)
    this.selectProject(id)
    return project
  }

  toggleProjectPin(id: string): void {
    this.projects = sortProjects(
      this.projects.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)),
    )
    saveProjects(this.projects)
  }

  setProjectLayout(patch: Partial<ProjectLayout>): void {
    const id = this.activeProjectId
    if (!id) return
    this.projects = this.projects.map((p) => {
      if (p.id !== id) return p
      const layout = clampProjectLayout(patch, p.layout)
      return { ...p, layout }
    })
    saveProjects(this.projects)
  }

  selectProject(id: string): void {
    if (this.activeProjectId === id) return
    this.stashActive()
    this.activeProjectId = id
    this.restore(id)
  }

  removeProject(id: string): void {
    this.workspaces.delete(id)
    this.projects = this.projects.filter((p) => p.id !== id)
    saveProjects(this.projects)
    if (this.activeProjectId === id) {
      this.activeProjectId = null
      this.session = null
      this.messages = []
      this.usage = null
      this.run = null
      this.streamingId = null
      const next = this.projects[0]?.id
      if (next) this.selectProject(next)
    }
  }

  pushLog(line: string): void {
    this.logs = [...this.logs.slice(-200), line]
  }

  notify(type: AppNotification['type'], title: string, detail?: string): void {
    const notification: AppNotification = {
      id: crypto.randomUUID(),
      type,
      title,
      detail,
      ts: Date.now(),
      read: false,
      visible: true,
    }
    this.notifications = [notification, ...this.notifications].slice(0, 50)
    window.setTimeout(() => this.dismissNotification(notification.id), 4500)
  }

  dismissNotification(id: string): void {
    this.notifications = this.notifications.map((item) =>
      item.id === id ? { ...item, visible: false } : item,
    )
  }

  toggleNotifications(): void {
    this.notificationsOpen = !this.notificationsOpen
    if (this.notificationsOpen) {
      this.notifications = this.notifications.map((item) => ({ ...item, read: true }))
    }
  }

  clearNotifications(): void {
    this.notifications = []
  }

  setKeybinding(action: KeybindingAction, binding: string): boolean {
    if (Object.entries(this.keybindings).some(([id, value]) => id !== action && value === binding)) return false
    this.keybindings = { ...this.keybindings, [action]: binding }
    localStorage.setItem('enpiistudio.keybindings', JSON.stringify(this.keybindings))
    return true
  }

  resetKeybindings(): void {
    this.keybindings = { ...defaultKeybindings }
    localStorage.setItem('enpiistudio.keybindings', JSON.stringify(this.keybindings))
  }

  pushMessage(
    msg: Omit<ChatMessage, 'id' | 'ts'> & { id?: string; tool?: ChatMessage['tool']; attachments?: ChatMessage['attachments'] },
  ): ChatMessage {
    const full: ChatMessage = {
      id: msg.id ?? crypto.randomUUID(),
      role: msg.role,
      text: msg.text,
      ts: Date.now(),
      attachments: msg.attachments,
      tool: msg.tool,
    }
    this.messages = [...this.messages, full]
    return full
  }

  appendToMessage(id: string, delta: string): void {
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, text: m.text + delta } : m,
    )
  }

  updateTool(callId: string, patch: Partial<NonNullable<ChatMessage['tool']>> & { text?: string }): void {
    this.messages = this.messages.map((m) => {
      if (m.role !== 'tool' || m.tool?.callId !== callId) return m
      return {
        ...m,
        text: patch.text ?? m.text,
        tool: { ...m.tool!, ...patch },
      }
    })
  }

  /** Accumulate provider usage into **session** totals (per turn add, not replace). */
  setUsage(u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }, mode: 'add' | 'replace' = 'add'): void {
    const next = {
      prompt: u.prompt_tokens ?? 0,
      completion: u.completion_tokens ?? 0,
      total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    }
    if (mode === 'replace' || !this.usage) {
      this.usage = next
      return
    }
    this.usage = {
      prompt: this.usage.prompt + next.prompt,
      completion: this.usage.completion + next.completion,
      total: this.usage.total + next.total,
    }
  }

  resetRun(): void {
    this.run = null
  }

  updateRun(patch: Partial<RunTelemetry> & { run?: Record<string, unknown> }): void {
    const nested = patch.run
    const goal = nested?.goal as Record<string, unknown> | undefined
    const usage = (patch.usage ?? nested?.usage) as {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
    } | undefined
    const next: RunTelemetry = {
      runId: this.run?.runId,
      status: this.run?.status ?? 'running',
      round: this.run?.round ?? 0,
      toolCount: this.run?.toolCount ?? 0,
      maxRounds: this.run?.maxRounds,
      maxTokens: this.run?.maxTokens,
      maxRuntimeMs: this.run?.maxRuntimeMs,
      maxRepairAttempts: this.run?.maxRepairAttempts,
      repairAttempts: this.run?.repairAttempts ?? 0,
      lastEvent: this.run?.lastEvent,
      error: this.run?.error,
      usage: this.run?.usage ?? null,
      checks: this.run?.checks ?? [],
      verifier: this.run?.verifier,
      context: this.run?.context,
      retries: this.run?.retries ?? 0,
      circuit: this.run?.circuit,
      tasks: this.run?.tasks ?? [],
      ...patch,
    }
    if (nested) {
      next.runId = String(nested.runId ?? next.runId ?? '') || undefined
      next.status = String(nested.status ?? next.status)
      next.round = Number(nested.round ?? next.round)
      next.toolCount = Number(nested.toolCount ?? next.toolCount ?? 0)
      next.lastEvent = typeof nested.lastEvent === 'string' ? nested.lastEvent : next.lastEvent
      next.error = typeof nested.error === 'string' ? nested.error : next.error
      next.repairAttempts = Number(nested.repairAttempts ?? next.repairAttempts)
      if (Array.isArray(nested.tasks)) next.tasks = nested.tasks as RunTelemetry['tasks']
      if (goal) {
        next.maxRounds = Number(goal.maxRounds ?? next.maxRounds)
        next.maxTokens = Number(goal.maxTokens ?? next.maxTokens)
        next.maxRuntimeMs = Number(goal.maxRuntimeMs ?? next.maxRuntimeMs)
        next.maxRepairAttempts = Number(goal.maxRepairAttempts ?? next.maxRepairAttempts)
      }
    }
    if (usage) {
      // Run-only snapshot. Session totals accumulate via setUsage on final `usage` event.
      next.usage = {
        prompt: usage.prompt_tokens ?? 0,
        completion: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
      }
    }
    this.run = next
  }

  addRunCheck(check: RunCheck): void {
    const current = this.run ?? this.newRun()
    this.run = { ...current, checks: [...current.checks.filter((item) => item.command !== check.command), check] }
  }

  private newRun(): RunTelemetry {
    return {
      status: 'running',
      round: 0,
      repairAttempts: 0,
      usage: null,
      checks: [],
      retries: 0,
      tasks: [],
    }
  }

  pushDiff(d: Omit<DiffItem, 'id' | 'ts'>): void {
    this.diffs = [
      { id: crypto.randomUUID(), ts: Date.now(), ...d },
      ...this.diffs,
    ].slice(0, 20)
  }

  clearApproval(requestId?: string): void {
    if (!requestId) {
      this.pendingApprovals = []
      return
    }
    this.pendingApprovals = this.pendingApprovals.filter((a) => a.requestId !== requestId)
  }

  enqueueApproval(a: ApprovalRequest): void {
    if (this.pendingApprovals.some((x) => x.requestId === a.requestId)) return
    this.pendingApprovals = [...this.pendingApprovals, a]
  }

  clearAsk(requestId?: string): void {
    if (!requestId) {
      this.pendingAsks = []
      return
    }
    this.pendingAsks = this.pendingAsks.filter((a) => a.requestId !== requestId)
  }

  enqueueAsk(a: AskUserRequest): void {
    if (this.pendingAsks.some((x) => x.requestId === a.requestId)) return
    this.pendingAsks = [...this.pendingAsks, a]
  }

  takeApproval(requestId: string): ApprovalRequest | null {
    const found = this.pendingApprovals.find((a) => a.requestId === requestId) ?? null
    if (found) this.clearApproval(requestId)
    return found
  }
}

export const state = new AppState()
