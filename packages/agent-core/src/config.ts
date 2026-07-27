import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseToml, stringifyToml, tomlString, tomlStringArray, type TomlTable } from './toml.js'

export type PermissionMode = 'read_only' | 'ask' | 'autopilot_workspace' | 'full'

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  dialect: 'openai' | 'anthropic'
  permissionMode: PermissionMode
  /** Extra deny globs merged with built-in sensitive defaults. */
  denyGlobs?: string[]
}

export type PublicProviderConfig = Omit<ProviderConfig, 'apiKey'> & {
  hasKey: boolean
  /** true when corresponding ENPII_* env is set (env wins over file on load) */
  envOverrides: {
    baseUrl: boolean
    apiKey: boolean
    model: boolean
    dialect: boolean
  }
}

const DEFAULTS: ProviderConfig = {
  baseUrl: 'https://ai.enpiistudio.com/v1',
  apiKey: '',
  model: 'enpii',
  dialect: 'openai',
  permissionMode: 'ask',
}

function enpiiHome(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function userJsonPath(): string {
  return path.join(enpiiHome(), 'config.json')
}

function userTomlPath(): string {
  return path.join(enpiiHome(), 'config.toml')
}

function projectTomlPath(projectRoot?: string): string | null {
  if (!projectRoot?.trim()) return null
  return path.join(path.resolve(projectRoot), '.enpii', 'config.toml')
}

function parsePermissionMode(v: unknown): PermissionMode | undefined {
  if (v === 'read_only' || v === 'ask' || v === 'autopilot_workspace' || v === 'full') {
    return v
  }
  return undefined
}

function partialFromRecord(data: Record<string, unknown>): Partial<ProviderConfig> {
  return {
    baseUrl:
      typeof data.baseUrl === 'string'
        ? data.baseUrl
        : typeof data.base_url === 'string'
          ? data.base_url
          : undefined,
    apiKey:
      typeof data.apiKey === 'string'
        ? data.apiKey
        : typeof data.api_key === 'string'
          ? data.api_key
          : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    dialect:
      data.dialect === 'anthropic' || data.dialect === 'openai'
        ? data.dialect
        : data.api_dialect === 'anthropic' || data.api_dialect === 'openai'
          ? data.api_dialect
          : undefined,
    permissionMode:
      parsePermissionMode(data.permissionMode) ??
      parsePermissionMode(data.permission_mode) ??
      parsePermissionMode(data.defaultPermissionMode),
    denyGlobs: Array.isArray(data.denyGlobs)
      ? data.denyGlobs.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
      : Array.isArray(data.deny_globs)
        ? data.deny_globs.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
        : undefined,
  }
}

function partialFromToml(table: TomlTable): Partial<ProviderConfig> {
  const dialectRaw = tomlString(table, 'dialect', 'api_dialect')
  const modeRaw =
    tomlString(table, 'permissionMode', 'permission_mode', 'defaultPermissionMode') ??
    (typeof table.permissionMode === 'string' ? table.permissionMode : undefined)
  return {
    baseUrl: tomlString(table, 'baseUrl', 'base_url'),
    apiKey: tomlString(table, 'apiKey', 'api_key'),
    model: tomlString(table, 'model'),
    dialect: dialectRaw === 'anthropic' || dialectRaw === 'openai' ? dialectRaw : undefined,
    permissionMode: parsePermissionMode(modeRaw),
    denyGlobs: tomlStringArray(table, 'denyGlobs') ?? tomlStringArray(table, 'deny_globs'),
  }
}

function readJsonFile(file: string): Partial<ProviderConfig> {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    const data = JSON.parse(raw) as Record<string, unknown>
    return partialFromRecord(data)
  } catch {
    return {}
  }
}

function readTomlFile(file: string): Partial<ProviderConfig> {
  try {
    if (!fs.existsSync(file)) return {}
    const raw = fs.readFileSync(file, 'utf8')
    return partialFromToml(parseToml(raw))
  } catch {
    return {}
  }
}

function mergePartial(...parts: Partial<ProviderConfig>[]): Partial<ProviderConfig> {
  const out: Partial<ProviderConfig> = {}
  for (const p of parts) {
    if (p.baseUrl !== undefined) out.baseUrl = p.baseUrl
    if (p.apiKey !== undefined) out.apiKey = p.apiKey
    if (p.model !== undefined) out.model = p.model
    if (p.dialect !== undefined) out.dialect = p.dialect
    if (p.permissionMode !== undefined) out.permissionMode = p.permissionMode
    if (p.denyGlobs !== undefined) out.denyGlobs = p.denyGlobs
  }
  return out
}

/**
 * Priority: env → project `.enpii/config.toml` → user `config.toml` → user `config.json` → defaults.
 * projectRoot optional (desktop passes active project).
 */
export function loadProviderConfig(projectRoot?: string): ProviderConfig {
  const userJson = readJsonFile(userJsonPath())
  const userToml = readTomlFile(userTomlPath())
  const projPath = projectTomlPath(projectRoot)
  const projectToml = projPath ? readTomlFile(projPath) : {}
  // later layers win for defined fields
  const file = mergePartial(userJson, userToml, projectToml)

  return {
    baseUrl: (
      process.env.ENPII_BASE_URL ||
      file.baseUrl ||
      DEFAULTS.baseUrl
    ).replace(/\/+$/, ''),
    apiKey: process.env.ENPII_API_KEY || file.apiKey || DEFAULTS.apiKey,
    model: process.env.ENPII_MODEL || file.model || DEFAULTS.model,
    dialect:
      process.env.ENPII_DIALECT === 'anthropic' || process.env.ENPII_DIALECT === 'openai'
        ? process.env.ENPII_DIALECT
        : file.dialect || DEFAULTS.dialect,
    permissionMode: file.permissionMode || DEFAULTS.permissionMode,
    denyGlobs: file.denyGlobs,
  }
}

export function publicConfig(cfg: ProviderConfig): PublicProviderConfig {
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    dialect: cfg.dialect,
    permissionMode: cfg.permissionMode,
    denyGlobs: cfg.denyGlobs,
    hasKey: Boolean(cfg.apiKey?.trim()),
    envOverrides: {
      baseUrl: Boolean(process.env.ENPII_BASE_URL),
      apiKey: Boolean(process.env.ENPII_API_KEY),
      model: Boolean(process.env.ENPII_MODEL),
      dialect: Boolean(process.env.ENPII_DIALECT),
    },
  }
}

export interface ProviderConfigPatch {
  baseUrl?: string
  /** omit or empty string = leave existing key; non-empty = replace */
  apiKey?: string
  model?: string
  dialect?: 'openai' | 'anthropic'
  permissionMode?: PermissionMode
  denyGlobs?: string[]
}

function toTomlTable(cfg: ProviderConfig): TomlTable {
  const t: TomlTable = {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey || '',
    model: cfg.model,
    dialect: cfg.dialect,
    permissionMode: cfg.permissionMode,
  }
  if (cfg.denyGlobs?.length) t.denyGlobs = cfg.denyGlobs
  return t
}

/**
 * Merge patch into live cfg, write user config.toml (and migrate away from json on next save).
 * Optional projectRoot writes project overlay only for non-secret fields when `scope: 'project'`.
 */
export function saveProviderConfig(
  current: ProviderConfig,
  patch: ProviderConfigPatch,
  opts?: { projectRoot?: string; scope?: 'user' | 'project' },
): ProviderConfig {
  const next: ProviderConfig = {
    baseUrl: (patch.baseUrl?.trim() || current.baseUrl).replace(/\/+$/, ''),
    apiKey:
      patch.apiKey !== undefined && patch.apiKey.trim() !== ''
        ? patch.apiKey.trim()
        : current.apiKey,
    model: patch.model?.trim() || current.model,
    dialect: patch.dialect === 'anthropic' || patch.dialect === 'openai' ? patch.dialect : current.dialect,
    permissionMode: parsePermissionMode(patch.permissionMode) ?? current.permissionMode,
    denyGlobs:
      patch.denyGlobs !== undefined
        ? patch.denyGlobs.filter((g) => typeof g === 'string' && g.trim())
        : current.denyGlobs,
  }

  if (!next.baseUrl) throw new Error('baseUrl is required')
  if (!next.model) throw new Error('model is required')

  const scope = opts?.scope ?? 'user'
  if (scope === 'project' && opts?.projectRoot) {
    // Project overlay: never store apiKey in repo
    const p = projectTomlPath(opts.projectRoot)!
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const existing = readTomlFile(p)
    const overlay: TomlTable = {
      baseUrl: next.baseUrl,
      model: next.model,
      dialect: next.dialect,
      permissionMode: next.permissionMode,
    }
    if (next.denyGlobs?.length) overlay.denyGlobs = next.denyGlobs
    // preserve any project apiKey only if already present (discouraged)
    if (existing.apiKey) overlay.apiKey = existing.apiKey
    fs.writeFileSync(p, stringifyToml(overlay), 'utf8')
    return next
  }

  const dir = enpiiHome()
  fs.mkdirSync(dir, { recursive: true })

  // Prefer TOML; keep existing key if patch left blank
  const prevToml = readTomlFile(userTomlPath())
  const prevJson = readJsonFile(userJsonPath())
  const apiKey = next.apiKey || prevToml.apiKey || prevJson.apiKey || ''
  const out: ProviderConfig = { ...next, apiKey }
  fs.writeFileSync(userTomlPath(), stringifyToml(toTomlTable(out)), 'utf8')

  // Leave legacy JSON if present (read still works); do not rewrite secrets into both.
  return out
}

export function assertProviderReady(cfg: ProviderConfig): void {
  if (!cfg.apiKey?.trim()) {
    throw new Error(
      'No API key. Open Settings or set ENPII_API_KEY / ~/.enpiistudio/config.toml',
    )
  }
  if (!cfg.baseUrl?.trim()) {
    throw new Error('No baseUrl for provider')
  }
}
