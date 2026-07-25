export type Mode = 'agent' | 'code' | 'terminal' | 'git'

export interface Project {
  id: string
  name: string
  path: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  ts: number
  tool?: {
    callId: string
    name: string
    args?: string
    status: 'running' | 'ok' | 'error'
    summary?: string
    preview?: string
  }
}

export interface SessionInfo {
  id: string
  title: string
  status: string
  model: string
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

export interface DiffItem {
  id: string
  name: string
  summary: string
  preview: string
  ts: number
}

function projectId(p: string): string {
  return btoa(unescape(encodeURIComponent(p))).replace(/=+$/, '').slice(0, 24)
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem('enpiistudio.projects')
    if (!raw) return []
    return JSON.parse(raw) as Project[]
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
  usage: TokenUsage | null
}

class AppState {
  mode = $state<Mode>('agent')
  projects = $state<Project[]>(loadProjects())
  activeProjectId = $state<string | null>(null)
  session = $state<SessionInfo | null>(null)
  sessionList = $state<SessionInfo[]>([])
  messages = $state<ChatMessage[]>([])
  composer = $state('')
  enpiiStatus = $state<'unknown' | 'ok' | 'error'>('unknown')
  enpiiInfo = $state<string>('')
  logs = $state<string[]>([])
  busy = $state(false)
  usage = $state<TokenUsage | null>(null)
  streamingId = $state<string | null>(null)
  approval = $state<ApprovalRequest | null>(null)
  diffs = $state<DiffItem[]>([])

  /** In-memory chat cache per project (disk is source of truth via enpii). */
  private workspaces = new Map<string, ProjectWorkspace>()

  get activeProject(): Project | null {
    return this.projects.find((p) => p.id === this.activeProjectId) ?? null
  }

  setMode(mode: Mode): void {
    this.mode = mode
  }

  private stashActive(): void {
    if (!this.activeProjectId) return
    this.workspaces.set(this.activeProjectId, {
      session: this.session,
      messages: this.messages,
      usage: this.usage,
    })
  }

  private restore(id: string): void {
    const ws = this.workspaces.get(id)
    this.session = ws?.session ?? null
    this.messages = ws?.messages ?? []
    this.usage = ws?.usage ?? null
    this.streamingId = null
    this.composer = ''
  }

  addProject(folderPath: string): Project {
    const name = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath
    const id = projectId(folderPath)
    const existing = this.projects.find((p) => p.id === id)
    if (existing) {
      this.selectProject(existing.id)
      return existing
    }
    const project: Project = { id, name, path: folderPath }
    this.projects = [project, ...this.projects]
    saveProjects(this.projects)
    this.selectProject(id)
    return project
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
      this.streamingId = null
      const next = this.projects[0]?.id
      if (next) this.selectProject(next)
    }
  }

  pushLog(line: string): void {
    this.logs = [...this.logs.slice(-200), line]
  }

  pushMessage(
    msg: Omit<ChatMessage, 'id' | 'ts'> & { id?: string; tool?: ChatMessage['tool'] },
  ): ChatMessage {
    const full: ChatMessage = {
      id: msg.id ?? crypto.randomUUID(),
      role: msg.role,
      text: msg.text,
      ts: Date.now(),
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

  setUsage(u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
    this.usage = {
      prompt: u.prompt_tokens ?? 0,
      completion: u.completion_tokens ?? 0,
      total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    }
  }

  pushDiff(d: Omit<DiffItem, 'id' | 'ts'>): void {
    this.diffs = [
      { id: crypto.randomUUID(), ts: Date.now(), ...d },
      ...this.diffs,
    ].slice(0, 20)
  }

  clearApproval(): void {
    this.approval = null
  }
}

export const state = new AppState()
