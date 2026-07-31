import { setLocale as setI18nLocale, type Locale } from './i18n/index.svelte'

export type Mode = 'agent' | 'code' | 'terminal' | 'git' | 'browser'
export type ComposerMode = 'manual' | 'accept_edits' | 'plan' | 'full_auto'
export type KeybindingAction =
  | 'palette'
  | 'settings'
  | 'notifications'
  | 'font.larger'
  | 'font.smaller'
  | `mode.${Mode}`
export type PermissionMode = 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
export type ProviderDialect = 'openai' | 'anthropic'
export type { Locale }

/** Single source — TopNav / palette / keybindings. Labels via t(labelKey). */
export const MODES: readonly { id: Mode; labelKey: string; openKey: string; shortcut: string }[] = [
  { id: 'agent', labelKey: 'mode.agent', openKey: 'mode.agent.open', shortcut: 'Mod+1' },
  { id: 'code', labelKey: 'mode.code', openKey: 'mode.code.open', shortcut: 'Mod+2' },
  { id: 'terminal', labelKey: 'mode.terminal', openKey: 'mode.terminal.open', shortcut: 'Mod+3' },
  { id: 'git', labelKey: 'mode.git', openKey: 'mode.git.open', shortcut: 'Mod+4' },
  { id: 'browser', labelKey: 'mode.browser', openKey: 'mode.browser.open', shortcut: 'Mod+5' },
] as const

export const COMPOSER_MODES: readonly {
  value: ComposerMode
  labelKey: string
  descriptionKey: string
  permission: PermissionMode
}[] = [
  { value: 'manual', labelKey: 'composer.manual', descriptionKey: 'composer.manual.desc', permission: 'read_only' },
  { value: 'accept_edits', labelKey: 'composer.acceptEdits', descriptionKey: 'composer.acceptEdits.desc', permission: 'ask' },
  { value: 'plan', labelKey: 'composer.plan', descriptionKey: 'composer.plan.desc', permission: 'read_only' },
  { value: 'full_auto', labelKey: 'composer.fullAuto', descriptionKey: 'composer.fullAuto.desc', permission: 'full' },
] as const

export const PERMISSION_MODES: readonly {
  value: PermissionMode
  labelKey: string
  descriptionKey: string
}[] = [
  { value: 'ask', labelKey: 'permission.ask', descriptionKey: 'permission.ask.desc' },
  { value: 'read_only', labelKey: 'permission.readOnly', descriptionKey: 'permission.readOnly.desc' },
  { value: 'autopilot_workspace', labelKey: 'permission.autopilot', descriptionKey: 'permission.autopilot.desc' },
  { value: 'full', labelKey: 'permission.full', descriptionKey: 'permission.full.desc' },
] as const

export const PROVIDER_DIALECTS: readonly {
  value: ProviderDialect
  labelKey: string
  descriptionKey: string
}[] = [
  { value: 'openai', labelKey: 'dialect.openai', descriptionKey: 'dialect.openai.desc' },
  { value: 'anthropic', labelKey: 'dialect.anthropic', descriptionKey: 'dialect.anthropic.desc' },
] as const

export const GLOBAL_ACTIONS: readonly {
  id: Exclude<KeybindingAction, `mode.${Mode}`>
  labelKey: string
  shortcut: string
}[] = [
  { id: 'palette', labelKey: 'action.palette', shortcut: 'Mod+K' },
  { id: 'settings', labelKey: 'action.settings', shortcut: 'Mod+,' },
  { id: 'notifications', labelKey: 'action.notifications', shortcut: 'Mod+Shift+N' },
  { id: 'font.larger', labelKey: 'action.zoomIn', shortcut: 'Mod+=' },
  { id: 'font.smaller', labelKey: 'action.zoomOut', shortcut: 'Mod+-' },
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
  // Numpad/shift +/- : treat as zoom keys, ignore Shift so Ctrl+Shift+= still matches Mod+=.
  let key = event.key
  let ignoreShift = false
  if (key === '+' || key === '=') {
    key = '='
    ignoreShift = true
  } else if (key === '_' || key === '-') {
    key = '-'
    ignoreShift = true
  } else if (key.length === 1) {
    key = key.toUpperCase()
  }
  const modifiers = [
    event.metaKey || event.ctrlKey ? 'Mod' : '',
    event.altKey ? 'Alt' : '',
    !ignoreShift && event.shiftKey ? 'Shift' : '',
  ].filter(Boolean)
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
  inspector: 260,
  center: 360,
} as const
export const LAYOUT_MAX = {
  sidebar: 400,
  inspector: 420,
} as const
export const LAYOUT_DEFAULT = {
  sidebar: 240,
  inspector: 280,
} as const

/** Bump → wipe corrupted rail widths from localStorage once. */
export const LAYOUT_VERSION = 5
const LAYOUT_VERSION_KEY = 'enpiistudio.layoutVersion'

/** Shell chrome: pad 12×2 + gap 12×2 (p-3 gap-3). */
const LAYOUT_CHROME = 48

export function clampProjectLayout(
  patch: Partial<ProjectLayout>,
  current?: ProjectLayout,
  opts?: { viewportWidth?: number },
): ProjectLayout {
  let side = Number(patch.sidebarWidth ?? current?.sidebarWidth ?? LAYOUT_DEFAULT.sidebar)
  let insp = Number(patch.inspectorWidth ?? current?.inspectorWidth ?? LAYOUT_DEFAULT.inspector)
  if (!Number.isFinite(side)) side = LAYOUT_DEFAULT.sidebar
  if (!Number.isFinite(insp)) insp = LAYOUT_DEFAULT.inspector
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

/** Force defaults when schema bumps (corrupt rails from old git shell). */
function defaultLayout(): ProjectLayout {
  return { sidebarWidth: LAYOUT_DEFAULT.sidebar, inspectorWidth: LAYOUT_DEFAULT.inspector }
}

function layoutNeedsReset(): boolean {
  try {
    return Number(localStorage.getItem(LAYOUT_VERSION_KEY) ?? 0) < LAYOUT_VERSION
  } catch {
    return true
  }
}

function markLayoutVersion(): void {
  try {
    localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION))
  } catch {
    /* ignore */
  }
}

export interface Project {
  id: string
  name: string
  path: string
  pinned?: boolean
  /** Display label override (folder name stays on disk). */
  displayName?: string
  groupId?: string | null
  /** Manual sidebar order (lower first). Pinned still float above. */
  order?: number
  layout?: ProjectLayout
}

export interface ProjectGroup {
  id: string
  name: string
  collapsed?: boolean
  order?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  ts: number
  /** Wall time from user send → turn idle (user bubbles). */
  durationMs?: number
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

/** Prompt waiting while agent is busy (FIFO). */
export interface QueuedPrompt {
  id: string
  text: string
  displayText?: string
  images?: { name: string; mime: string; dataUrl: string }[]
  attachments?: { name: string; kind?: 'text' | 'image' }[]
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
  /** Cache hits (subset of prompt), when provider reports. */
  cached?: number
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

/** One choice on an ask_user card (label is what gets sent back). */
export interface AskOption {
  label: string
  description?: string
  recommended?: boolean
}

/** Mid-run ask_user question from agent. */
export interface AskUserRequest {
  requestId: string
  sessionId: string
  toolCallId: string
  question: string
  /** Rich options (preferred). */
  options?: AskOption[]
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
  editedArgs?: string
  reason?: string
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
    const ao = a.order ?? 0
    const bo = b.order ?? 0
    if (ao !== bo) return ao - bo
    return (a.displayName || a.name).localeCompare(b.displayName || b.name)
  })
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem('enpiistudio.projects')
    if (!raw) {
      markLayoutVersion()
      return []
    }
    const parsed = JSON.parse(raw) as Project[]
    const reset = layoutNeedsReset()
    const migrated = sortProjects([...new Map(parsed
      .filter((project) => typeof project?.path === 'string' && project.path.trim())
      .map((project, index) => {
        const path = project.path
        const layout = reset ? defaultLayout() : clampProjectLayout({}, project.layout)
        return [projectPathKey(path), {
          ...project,
          id: projectId(path),
          pinned: Boolean(project.pinned),
          displayName: typeof project.displayName === 'string' ? project.displayName : undefined,
          groupId: typeof project.groupId === 'string' ? project.groupId : null,
          order: typeof project.order === 'number' ? project.order : index,
          layout,
        }]
      })).values()])
    if (reset || JSON.stringify(migrated) !== JSON.stringify(parsed)) {
      localStorage.setItem('enpiistudio.projects', JSON.stringify(migrated))
    }
    markLayoutVersion()
    return migrated
  } catch {
    return []
  }
}

function saveProjects(list: Project[]): void {
  localStorage.setItem('enpiistudio.projects', JSON.stringify(list))
}

function loadGroups(): ProjectGroup[] {
  try {
    const raw = localStorage.getItem('enpiistudio.projectGroups')
    if (!raw) return []
    const parsed = JSON.parse(raw) as ProjectGroup[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((g) => typeof g?.id === 'string' && typeof g?.name === 'string')
      .map((g, index) => ({
        id: g.id,
        name: g.name.trim() || 'Group',
        collapsed: Boolean(g.collapsed),
        order: typeof g.order === 'number' ? g.order : index,
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function saveGroups(list: ProjectGroup[]): void {
  localStorage.setItem('enpiistudio.projectGroups', JSON.stringify(list))
}

export type UiTheme = 'dark' | 'light' | 'system'

/** Mono stacks for Code / Terminal / vendor CLIs. */
export const FONT_FAMILIES = [
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace" },
  { id: 'sfmono', label: 'SF Mono', stack: "'SF Mono', ui-monospace, Menlo, monospace" },
  { id: 'cascadia', label: 'Cascadia Code', stack: "'Cascadia Code', 'Segoe UI Mono', monospace" },
  { id: 'fira', label: 'Fira Code', stack: "'Fira Code', ui-monospace, monospace" },
  { id: 'consolas', label: 'Consolas', stack: "Consolas, 'Courier New', monospace" },
  { id: 'menlo', label: 'Menlo', stack: "Menlo, Monaco, monospace" },
  { id: 'system', label: 'System mono', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
] as const

export type FontFamilyId = (typeof FONT_FAMILIES)[number]['id']

/** Whole-UI zoom (%). Scales chat, chrome, code, terminal together. */
export const UI_ZOOM_MIN = 80
export const UI_ZOOM_MAX = 150
export const UI_ZOOM_DEFAULT = 100
export const UI_ZOOM_STEP = 10

/** Base mono size for CodeMirror / xterm before CSS zoom. */
export const EDITOR_FONT_SIZE = 13

export interface UiPrefs {
  theme: UiTheme
  /** Gold pulse on busy indicators (.studio-signal). */
  goldPulse: boolean
  /** Stream assistant tokens as they arrive (UI). */
  streamTokens: boolean
  /** UI language. */
  locale: Locale
  /** Whole-app zoom percent (80–150). */
  uiZoom: number
  /** Code / terminal mono family id. */
  fontFamily: FontFamilyId
  /** Max model↔tool rounds per prompt (agent goal.maxRounds). */
  maxTurns: number
}

const UI_PREFS_KEY = 'enpiistudio.uiPrefs'
const DEFAULT_UI_PREFS: UiPrefs = {
  theme: 'dark',
  goldPulse: true,
  streamTokens: true,
  locale: 'en',
  uiZoom: UI_ZOOM_DEFAULT,
  fontFamily: 'jetbrains',
  maxTurns: 24,
}

function clampMaxTurns(n: unknown): number {
  const v = typeof n === 'number' ? Math.floor(n) : NaN
  return Number.isFinite(v) ? Math.min(32, Math.max(1, v)) : 24
}

function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return UI_ZOOM_DEFAULT
  const stepped = Math.round(n / UI_ZOOM_STEP) * UI_ZOOM_STEP
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, stepped))
}

function normalizeFontFamily(id: unknown): FontFamilyId {
  return FONT_FAMILIES.some((f) => f.id === id) ? (id as FontFamilyId) : 'jetbrains'
}

export function fontStack(id: FontFamilyId = 'jetbrains'): string {
  return FONT_FAMILIES.find((f) => f.id === id)?.stack ?? FONT_FAMILIES[0].stack
}

function applyUiCss(prefs: UiPrefs): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--font-mono', fontStack(prefs.fontFamily))
  // Prefer Electron webFrame zoom — CSS `zoom` on <html> breaks drag text selection.
  root.style.zoom = ''
  const factor = clampZoom(prefs.uiZoom) / 100
  try {
    window.enpiistudio?.app?.setZoomFactor?.(factor)
  } catch {
    // Fallback only if preload missing (e.g. pure browser preview).
    root.style.zoom = `${prefs.uiZoom}%`
  }
}

function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return { ...DEFAULT_UI_PREFS }
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'system' || parsed.theme === 'dark' ? parsed.theme : 'dark',
      goldPulse: parsed.goldPulse !== false,
      streamTokens: parsed.streamTokens !== false,
      locale: parsed.locale === 'id' ? 'id' : 'en',
      uiZoom: clampZoom(typeof parsed.uiZoom === 'number' ? parsed.uiZoom : UI_ZOOM_DEFAULT),
      fontFamily: normalizeFontFamily(parsed.fontFamily),
      maxTurns: clampMaxTurns(parsed.maxTurns ?? DEFAULT_UI_PREFS.maxTurns),
    }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

function saveUiPrefs(prefs: UiPrefs): void {
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs))
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
  pendingAsks?: AskUserRequest[]
  planMode?: boolean
  promptQueue?: QueuedPrompt[]
  turnStartedAt?: number | null
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
  /** ms epoch when current turn started (for live elapsed). */
  turnStartedAt?: number | null
  promptQueue?: QueuedPrompt[]
}

class AppState {
  mode = $state<Mode>('agent')
  projects = $state<Project[]>(loadProjects())
  projectGroups = $state<ProjectGroup[]>(loadGroups())
  activeProjectId = $state<string | null>(null)
  /** Local UI prefs (Appearance + Provider runtime toggles). */
  ui = $state<UiPrefs>(loadUiPrefs())
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
  /** Current turn start (Date.now) while busy — drives live timer. */
  turnStartedAt = $state<number | null>(null)
  /** FIFO prompts to send after agent finishes. */
  promptQueue = $state<QueuedPrompt[]>([])
  /** Active approval queue (multi pending). `approval` = head for compat. */
  pendingApprovals = $state<ApprovalRequest[]>([])
  /** Active ask_user queue. */
  pendingAsks = $state<AskUserRequest[]>([])
  /** Session-level plan mode flag (from enter_plan_mode / Composer Plan). */
  planMode = $state(false)
  /** Latest draft plan on disk (UI approve/reject). */
  draftPlan = $state<{
    id: string
    status: string
    title: string
    steps: { title: string; detail?: string }[]
    relPath: string
  } | null>(null)
  /** Latest approved plan (badge / context). */
  activePlan = $state<{
    id: string
    status: string
    title: string
    steps: { title: string; detail?: string }[]
    relPath: string
  } | null>(null)
  /** Mutation kinds granted via Allow for session (UI mirror; core is source of truth). */
  sessionGrantKinds = $state<Array<'write' | 'shell' | 'git' | 'mcp'>>([])
  /** In-chat team strips (hide when empty — not permanent Inspector panels). */
  teamBoard = $state<
    Array<{
      id: string
      title: string
      status: string
      blockedBy: string[]
      note?: string
      progress?: number
    }>
  >([])
  teamMail = $state<
    Array<{ id: string; from: string; to: string; content: string; type: string; createdAt: string }>
  >([])
  teamSubs = $state<
    Array<{
      id: string
      name: string
      description: string
      status: string
      worktreeBranch?: string
      lastSummary?: string
    }>
  >([])
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
    models?: string[]
    dialect: ProviderDialect
    permissionMode: PermissionMode
    denyGlobs?: string[]
    allowRules?: string[]
    guardrails?: {
      enabled: boolean
      applyToInput?: boolean
      applyToOutput?: boolean
      applyToToolResults?: boolean
    }
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
  /** sessionId → projectId for multi-project busy dots. */
  sessionProject = $state<Record<string, string>>({})
  /** Last in-app approval toast id — update in place instead of spamming. */
  approvalNotifId = $state<string | null>(null)

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
      turnStartedAt: null,
      promptQueue: [],
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
      turnStartedAt: this.turnStartedAt,
      promptQueue: this.promptQueue,
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
    this.turnStartedAt = live.turnStartedAt ?? null
    this.promptQueue = live.promptQueue ?? []
    return true
  }

  enqueuePrompt(item: Omit<QueuedPrompt, 'id'> & { id?: string }): QueuedPrompt {
    const full: QueuedPrompt = { id: item.id ?? crypto.randomUUID(), ...item }
    this.promptQueue = [...this.promptQueue, full]
    this.stashLiveSession()
    return full
  }

  dequeuePrompt(): QueuedPrompt | null {
    if (!this.promptQueue.length) return null
    const [head, ...rest] = this.promptQueue
    this.promptQueue = rest
    this.stashLiveSession()
    return head ?? null
  }

  removeQueuedPrompt(id: string): void {
    this.promptQueue = this.promptQueue.filter((p) => p.id !== id)
    this.stashLiveSession()
  }

  /** Stamp durationMs on the latest user message of this turn. */
  finishTurnTimer(sessionId?: string | null): void {
    const sid = sessionId ?? this.session?.id
    const live = sid ? this.liveSessions.get(sid) : undefined
    const started =
      (this.session?.id === sid ? this.turnStartedAt : null) ?? live?.turnStartedAt ?? null
    if (!started) return
    const ms = Math.max(0, Date.now() - started)
    const stamp = (messages: ChatMessage[]): ChatMessage[] => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.role === 'user' && messages[i]!.durationMs == null) {
          const next = messages.slice()
          next[i] = { ...next[i]!, durationMs: ms }
          return next
        }
      }
      return messages
    }
    if (this.session?.id === sid) {
      this.messages = stamp(this.messages)
      this.turnStartedAt = null
    }
    if (live) {
      live.messages = stamp(live.messages)
      live.turnStartedAt = null
    }
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
      if (patch.pendingAsks) this.pendingAsks = patch.pendingAsks
      if (patch.planMode !== undefined) this.planMode = patch.planMode
      if (patch.approvals) this.approvals = patch.approvals
      if (patch.diffs) this.diffs = patch.diffs
      if (patch.checkpoints) this.checkpoints = patch.checkpoints
      if (typeof patch.busy === 'boolean') this.busy = patch.busy
      if (patch.status) this.session = { ...this.session, status: patch.status }
      if (patch.turnStartedAt !== undefined) this.turnStartedAt = patch.turnStartedAt
      if (patch.promptQueue) this.promptQueue = patch.promptQueue
    }
  }

  setSessionBusy(sessionId: string, busy: boolean): void {
    this.sessionBusy = { ...this.sessionBusy, [sessionId]: busy }
    const live = this.getLive(sessionId)
    live.busy = busy
    this.liveSessions.set(sessionId, live)
    if (this.session?.id === sessionId) this.busy = busy
    if (this.activeProjectId && this.session?.id === sessionId) {
      this.sessionProject = { ...this.sessionProject, [sessionId]: this.activeProjectId }
    }
  }

  /** Bind session → project (call on open/new session). */
  bindSessionProject(sessionId: string, projectId?: string | null): void {
    const pid = projectId ?? this.activeProjectId
    if (!pid) return
    this.sessionProject = { ...this.sessionProject, [sessionId]: pid }
  }

  isSessionBusy(sessionId: string): boolean {
    if (this.session?.id === sessionId) return this.busy
    return Boolean(this.sessionBusy[sessionId] ?? this.liveSessions.get(sessionId)?.busy)
  }

  /** Any agent turn running for this project (active or background session). */
  isProjectBusy(projectId: string): boolean {
    // Touch $state so sidebar re-renders when busy/approvals change.
    void this.busy
    void this.pendingApprovals.length
    void this.sessionBusy
    if (this.activeProjectId === projectId && (this.busy || this.pendingApprovals.length > 0)) {
      return true
    }
    for (const [sid, pid] of Object.entries(this.sessionProject)) {
      if (pid !== projectId) continue
      if (this.isSessionBusy(sid)) return true
      const live = this.liveSessions.get(sid)
      if (live && (live.busy || live.pendingApprovals.length > 0)) return true
    }
    return false
  }

  /** One toast for the approval queue — refresh detail, don't stack 20 cards. */
  notifyApprovalQueue(detail: string, background = false): void {
    const n = this.pendingApprovals.length
    const title = background
      ? 'Approval (other session)'
      : n > 1
        ? `Approval required (${n})`
        : 'Approval required'
    if (this.approvalNotifId) {
      const existing = this.notifications.find((x) => x.id === this.approvalNotifId)
      if (existing && existing.visible) {
        this.notifications = this.notifications.map((item) =>
          item.id === this.approvalNotifId
            ? { ...item, title, detail, ts: Date.now(), read: false, visible: true, type: 'warning' as const }
            : item,
        )
        return
      }
    }
    const id = crypto.randomUUID()
    this.approvalNotifId = id
    const notification: AppNotification = {
      id,
      type: 'warning',
      title,
      detail,
      ts: Date.now(),
      read: false,
      visible: true,
    }
    this.notifications = [
      notification,
      ...this.notifications,
    ].slice(0, 50)
    // Sticky longer while queue open — still auto-hide eventually
    window.setTimeout(() => this.dismissNotification(id), 8000)
  }

  clearApprovalNotif(): void {
    if (this.approvalNotifId) {
      this.dismissNotification(this.approvalNotifId)
      this.approvalNotifId = null
    }
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
      this.pendingAsks = live.pendingAsks ?? []
      this.planMode = live.planMode ?? false
      this.approvals = live.approvals
      this.diffs = live.diffs
      this.checkpoints = live.checkpoints
      this.busy = live.busy
      this.turnStartedAt = live.turnStartedAt ?? null
      this.promptQueue = live.promptQueue ?? []
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
      pendingAsks: this.pendingAsks,
      planMode: this.planMode,
      promptQueue: this.promptQueue,
      turnStartedAt: this.turnStartedAt,
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
    this.pendingAsks = ws?.pendingAsks ?? []
    this.planMode = ws?.planMode ?? false
    this.promptQueue = ws?.promptQueue ?? []
    this.turnStartedAt = ws?.turnStartedAt ?? null
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
    const maxOrder = this.projects.reduce((m, p) => Math.max(m, p.order ?? 0), -1)
    const project: Project = {
      id,
      name,
      path: folderPath,
      order: maxOrder + 1,
      groupId: null,
      layout: { sidebarWidth: LAYOUT_DEFAULT.sidebar, inspectorWidth: LAYOUT_DEFAULT.inspector },
    }
    this.projects = sortProjects([...this.projects, project])
    saveProjects(this.projects)
    this.selectProject(id)
    return project
  }

  projectLabel(project: Project): string {
    return project.displayName?.trim() || project.name
  }

  toggleProjectPin(id: string): void {
    this.projects = sortProjects(
      this.projects.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)),
    )
    saveProjects(this.projects)
  }

  renameProject(id: string, displayName: string): void {
    const label = displayName.trim()
    this.projects = this.projects.map((p) =>
      p.id === id ? { ...p, displayName: label || undefined } : p,
    )
    saveProjects(this.projects)
  }

  createProjectGroup(name = 'New group'): ProjectGroup {
    const group: ProjectGroup = {
      id: crypto.randomUUID(),
      name: name.trim() || 'New group',
      collapsed: false,
      order: this.projectGroups.reduce((m, g) => Math.max(m, g.order ?? 0), -1) + 1,
    }
    this.projectGroups = [...this.projectGroups, group]
    saveGroups(this.projectGroups)
    return group
  }

  renameProjectGroup(id: string, name: string): void {
    const label = name.trim()
    if (!label) return
    this.projectGroups = this.projectGroups.map((g) => (g.id === id ? { ...g, name: label } : g))
    saveGroups(this.projectGroups)
  }

  toggleProjectGroup(id: string): void {
    this.projectGroups = this.projectGroups.map((g) =>
      g.id === id ? { ...g, collapsed: !g.collapsed } : g,
    )
    saveGroups(this.projectGroups)
  }

  setProjectGroup(projectId: string, groupId: string | null): void {
    this.projects = this.projects.map((p) => (p.id === projectId ? { ...p, groupId } : p))
    saveProjects(this.projects)
  }

  /** Dissolve group — projects become ungrouped; group removed. */
  ungroupProjectGroup(id: string): void {
    this.projects = this.projects.map((p) => (p.groupId === id ? { ...p, groupId: null } : p))
    this.projectGroups = this.projectGroups.filter((g) => g.id !== id)
    saveProjects(this.projects)
    saveGroups(this.projectGroups)
  }

  removeProjectGroup(id: string): void {
    this.ungroupProjectGroup(id)
  }

  /** Reorder by full id sequence (projects only). Preserves relative pin priority via sort. */
  reorderProjects(orderedIds: string[]): void {
    const rank = new Map(orderedIds.map((id, i) => [id, i]))
    this.projects = sortProjects(
      this.projects.map((p) => (rank.has(p.id) ? { ...p, order: rank.get(p.id)! } : p)),
    )
    saveProjects(this.projects)
  }

  reorderProjectGroups(orderedIds: string[]): void {
    const rank = new Map(orderedIds.map((id, i) => [id, i]))
    this.projectGroups = [...this.projectGroups]
      .map((g) => (rank.has(g.id) ? { ...g, order: rank.get(g.id)! } : g))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
    saveGroups(this.projectGroups)
  }

  /** Move project before/after target (same list order). */
  moveProjectRelative(dragId: string, targetId: string, place: 'before' | 'after'): void {
    if (dragId === targetId) return
    const ids = sortProjects(this.projects).map((p) => p.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    const insertAt = ids.indexOf(targetId) + (place === 'after' ? 1 : 0)
    ids.splice(Math.max(0, insertAt), 0, dragId)
    // Inherit target group so DnD into a group works
    const target = this.projects.find((p) => p.id === targetId)
    if (target) {
      this.projects = this.projects.map((p) =>
        p.id === dragId ? { ...p, groupId: target.groupId ?? null } : p,
      )
    }
    this.reorderProjects(ids)
  }

  moveProjectToGroupEdge(dragId: string, groupId: string | null, place: 'start' | 'end' = 'end'): void {
    const inGroup = sortProjects(this.projects.filter((p) => (p.groupId ?? null) === groupId)).map((p) => p.id)
    const rest = sortProjects(this.projects.filter((p) => (p.groupId ?? null) !== groupId && p.id !== dragId)).map((p) => p.id)
    const nextIn = inGroup.filter((id) => id !== dragId)
    if (place === 'start') nextIn.unshift(dragId)
    else nextIn.push(dragId)
    this.projects = this.projects.map((p) => (p.id === dragId ? { ...p, groupId } : p))
    this.reorderProjects([...nextIn, ...rest.filter((id) => !nextIn.includes(id))])
  }

  setProjectLayout(patch: Partial<ProjectLayout>): void {
    const id = this.activeProjectId
    // Empty patch without active project → reclamp/reset every project (mount heal).
    if (!id) {
      if (Object.keys(patch).length === 0) {
        this.projects = this.projects.map((p) => ({
          ...p,
          layout: clampProjectLayout({}, p.layout),
        }))
        saveProjects(this.projects)
      }
      return
    }
    this.projects = this.projects.map((p) => {
      if (p.id !== id) return p
      const layout = clampProjectLayout(patch, p.layout)
      return { ...p, layout }
    })
    saveProjects(this.projects)
  }

  /** Hard-reset all rails to defaults (layout schema migration / user fix). */
  resetAllLayouts(): void {
    this.projects = this.projects.map((p) => ({ ...p, layout: defaultLayout() }))
    saveProjects(this.projects)
    markLayoutVersion()
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
  setUsage(
    u: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      cached_tokens?: number
    },
    mode: 'add' | 'replace' = 'add',
  ): void {
    const next: TokenUsage = {
      prompt: u.prompt_tokens ?? 0,
      completion: u.completion_tokens ?? 0,
      total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
      cached: u.cached_tokens ?? 0,
    }
    if (mode === 'replace' || !this.usage) {
      this.usage = next.cached ? next : { prompt: next.prompt, completion: next.completion, total: next.total }
      return
    }
    const cached = (this.usage.cached ?? 0) + (next.cached ?? 0)
    this.usage = {
      prompt: this.usage.prompt + next.prompt,
      completion: this.usage.completion + next.completion,
      total: this.usage.total + next.total,
      cached: cached || undefined,
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
      cached_tokens?: number
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
      const cached = usage.cached_tokens ?? 0
      next.usage = {
        prompt: usage.prompt_tokens ?? 0,
        completion: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
        cached: cached > 0 ? cached : undefined,
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

  private persistUi(): void {
    saveUiPrefs(this.ui)
  }

  setGoldPulse(on: boolean): void {
    this.ui = { ...this.ui, goldPulse: on }
    this.persistUi()
  }

  setStreamTokens(on: boolean): void {
    this.ui = { ...this.ui, streamTokens: on }
    this.persistUi()
  }

  setTheme(theme: UiTheme): void {
    this.ui = { ...this.ui, theme }
    this.persistUi()
  }

  setLocale(locale: Locale): void {
    const next: Locale = locale === 'id' ? 'id' : 'en'
    this.ui = { ...this.ui, locale: next }
    setI18nLocale(next)
    this.persistUi()
  }

  setUiZoom(zoom: number): void {
    this.ui = { ...this.ui, uiZoom: clampZoom(zoom) }
    applyUiCss(this.ui)
    this.persistUi()
  }

  bumpUiZoom(deltaSteps = 1): void {
    this.setUiZoom(this.ui.uiZoom + deltaSteps * UI_ZOOM_STEP)
  }

  setFontFamily(id: FontFamilyId): void {
    this.ui = { ...this.ui, fontFamily: normalizeFontFamily(id) }
    applyUiCss(this.ui)
    this.persistUi()
  }

  setMaxTurns(n: number): void {
    this.ui = { ...this.ui, maxTurns: clampMaxTurns(n) }
    this.persistUi()
  }
}

export const state = new AppState()

// Sync i18n + zoom/font CSS with persisted prefs before first paint.
setI18nLocale(state.ui.locale)
applyUiCss(state.ui)
