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

export interface SessionMeta {
  id: Id
  contractVersion: '0.1.0'
  projectRoot: string
  title: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
  model: string
  dialect: 'anthropic' | 'openai'
  permissionMode: 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
  status: 'idle' | 'running' | 'awaiting_approval' | 'error' | 'archived'
  endpointId?: string
}
