/** Contract 0.1.0 — subset used by sidecar bootstrap */

export type Id = string
export type ISODateTime = string

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcError {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcError

export interface HealthResult {
  ok: true
  name: 'enpii'
  version: string
  contractVersion: '0.1.0'
  pid: number
}

export interface SessionUsageTotals {
  prompt: number
  completion: number
  total: number
}

export interface SessionMeta {
  id: Id
  contractVersion: '0.1.0'
  /** Tool jail root (main project or worktree path). */
  projectRoot: string
  /** Main project root when `projectRoot` is an isolated git worktree. */
  baseProjectRoot?: string
  /** Branch checked out in the worktree (if any). */
  worktreeBranch?: string
  title: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
  model: string
  dialect: 'anthropic' | 'openai'
  permissionMode: 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
  status: 'idle' | 'running' | 'awaiting_approval' | 'error' | 'archived'
  endpointId?: string
  /** When false, skip durable memory inject for this session (default true). */
  loadMemory?: boolean
  /** Accumulated token usage for this session (when endpoint reports usage). */
  usage?: SessionUsageTotals
}

export interface GoalContract {
  goal: string
  acceptanceCriteria?: string[]
  maxRounds?: number
  maxTokens?: number
  maxRuntimeMs?: number
  maxRepairAttempts?: number
  verificationCommands?: string[]
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'verifying'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RunTask {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  detail?: string
  startedAt?: ISODateTime
  finishedAt?: ISODateTime
  toolCount?: number
}

export interface RunState {
  sessionId: Id
  runId: Id
  goal: GoalContract
  tasks: RunTask[]
  status: RunStatus
  round: number
  toolCount: number
  repairAttempts: number
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  lastEvent?: string
  error?: string
  startedAt: ISODateTime
  updatedAt: ISODateTime
  finishedAt?: ISODateTime
}
