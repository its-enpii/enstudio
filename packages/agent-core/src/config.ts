import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  defaultGuardrailsConfig,
  resolveGuardrailsConfig,
  type GuardrailsConfig,
  type GuardRule,
  type GuardStrategy,
  type PiiType,
} from './guardrails.js'
import { mergeAllowRules, parseAllowRules } from './permission-rules.js'
import { parseToml, stringifyToml, tomlString, tomlStringArray, type TomlTable } from './toml.js'

export type PermissionMode = 'read_only' | 'ask' | 'autopilot_workspace' | 'full'
export type { GuardrailsConfig, GuardRule }

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  /** Active / default model id. */
  model: string
  /** Saved model ids for pickers (Settings + vendor launch). Always includes `model`. */
  models: string[]
  dialect: 'openai' | 'anthropic'
  permissionMode: PermissionMode
  /** Extra deny globs merged with built-in sensitive defaults. */
  denyGlobs?: string[]
  /**
   * Claude-style allow rules (union of user + project).
   * e.g. `run_shell(npm *)`, `web_fetch(domain:github.com)`, `git_status`.
   */
  allowRules?: string[]
  /** Deterministic PII/secret filters (optional; defaults applied in loop when absent). */
  guardrails?: GuardrailsConfig
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

/**
 * Empty defaults: app must not silently pick a model or endpoint.
 * On fresh install, model/baseUrl/apiKey are all '' — Settings → Provider blocks
 * agent turns until user fills them in (see assertProviderReady).
 */
const DEFAULTS: ProviderConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
  models: [],
  dialect: 'openai',
  permissionMode: 'ask',
}

function normalizeModels(models: unknown, active?: string): string[] {
  const raw = Array.isArray(models)
    ? models.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim())
    : []
  const out: string[] = []
  for (const m of raw) if (!out.includes(m)) out.push(m)
  const cur = active?.trim()
  if (cur && !out.includes(cur)) out.unshift(cur)
  // No silent fallback to DEFAULTS.model — fresh install stays empty until user configures.
  return out
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
  const model = typeof data.model === 'string' ? data.model : undefined
  const modelsRaw = data.models ?? data.model_list
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
    model,
    models: Array.isArray(modelsRaw) ? normalizeModels(modelsRaw, model) : undefined,
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
    allowRules: parseAllowRules(
      data.allowRules ??
        data.allow_rules ??
        (data.permissions && typeof data.permissions === 'object'
          ? (data.permissions as Record<string, unknown>).allow
          : undefined),
    ),
    guardrails: parseGuardrails(data.guardrails),
  }
}

function parseGuardStrategy(v: unknown): GuardStrategy | undefined {
  return v === 'redact' || v === 'mask' || v === 'block' ? v : undefined
}

function parsePiiType(v: unknown): PiiType | undefined {
  return v === 'email' || v === 'credit_card' || v === 'api_key' || v === 'private_key' || v === 'aws_key' || v === 'custom'
    ? v
    : undefined
}

function parseGuardrails(raw: unknown): GuardrailsConfig | undefined {
  if (raw === false) return { ...defaultGuardrailsConfig(), enabled: false }
  if (raw === true) return defaultGuardrailsConfig()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const rulesRaw = Array.isArray(o.rules) ? o.rules : undefined
  const rules: GuardRule[] | undefined = rulesRaw
    ?.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const row = item as Record<string, unknown>
      const type = parsePiiType(row.type)
      const strategy = parseGuardStrategy(row.strategy) ?? 'redact'
      if (!type) return null
      const rule: GuardRule = { type, strategy }
      if (typeof row.pattern === 'string' && row.pattern.trim()) rule.pattern = row.pattern.trim()
      return rule
    })
    .filter((r): r is GuardRule => Boolean(r))
  return resolveGuardrailsConfig({
    enabled: o.enabled === false ? false : o.enabled === true ? true : undefined,
    applyToInput: typeof o.applyToInput === 'boolean' ? o.applyToInput : typeof o.apply_to_input === 'boolean' ? o.apply_to_input : undefined,
    applyToOutput: typeof o.applyToOutput === 'boolean' ? o.applyToOutput : typeof o.apply_to_output === 'boolean' ? o.apply_to_output : undefined,
    applyToToolResults:
      typeof o.applyToToolResults === 'boolean'
        ? o.applyToToolResults
        : typeof o.apply_to_tool_results === 'boolean'
          ? o.apply_to_tool_results
          : undefined,
    rules,
  })
}

function partialFromToml(table: TomlTable): Partial<ProviderConfig> {
  const dialectRaw = tomlString(table, 'dialect', 'api_dialect')
  const modeRaw =
    tomlString(table, 'permissionMode', 'permission_mode', 'defaultPermissionMode') ??
    (typeof table.permissionMode === 'string' ? table.permissionMode : undefined)
  const model = tomlString(table, 'model')
  const modelsArr = tomlStringArray(table, 'models') ?? tomlStringArray(table, 'model_list')
  return {
    baseUrl: tomlString(table, 'baseUrl', 'base_url'),
    apiKey: tomlString(table, 'apiKey', 'api_key'),
    model,
    models: modelsArr ? normalizeModels(modelsArr, model) : undefined,
    dialect: dialectRaw === 'anthropic' || dialectRaw === 'openai' ? dialectRaw : undefined,
    permissionMode: parsePermissionMode(modeRaw),
    denyGlobs: tomlStringArray(table, 'denyGlobs') ?? tomlStringArray(table, 'deny_globs'),
    allowRules: (() => {
      const top = tomlStringArray(table, 'allowRules') ?? tomlStringArray(table, 'allow_rules')
      const perm = table.permissions
      const fromSection =
        perm && typeof perm === 'object' && !Array.isArray(perm)
          ? tomlStringArray(perm as TomlTable, 'allow')
          : undefined
      const merged = mergeAllowRules(top, fromSection)
      return merged
    })(),
    guardrails: (() => {
      const g = table.guardrails
      if (g === false || g === true) return parseGuardrails(g)
      if (g && typeof g === 'object' && !Array.isArray(g)) return parseGuardrails(g)
      return undefined
    })(),
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
    if (p.models !== undefined) out.models = p.models
    if (p.dialect !== undefined) out.dialect = p.dialect
    if (p.permissionMode !== undefined) out.permissionMode = p.permissionMode
    if (p.denyGlobs !== undefined) out.denyGlobs = p.denyGlobs
    // allowRules: union layers (user ∪ project), don't replace
    if (p.allowRules !== undefined) {
      out.allowRules = mergeAllowRules(out.allowRules, p.allowRules)
    }
    if (p.guardrails !== undefined) out.guardrails = p.guardrails
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

  const model = process.env.ENPII_MODEL ?? file.model ?? ''
  return {
    baseUrl: (
      process.env.ENPII_BASE_URL ??
      file.baseUrl ??
      ''
    ).replace(/\/+$/, ''),
    apiKey: process.env.ENPII_API_KEY ?? file.apiKey ?? '',
    model,
    models: normalizeModels(file.models ?? [], model),
    dialect:
      process.env.ENPII_DIALECT === 'anthropic' || process.env.ENPII_DIALECT === 'openai'
        ? process.env.ENPII_DIALECT
        : file.dialect ?? DEFAULTS.dialect,
    permissionMode: file.permissionMode ?? DEFAULTS.permissionMode,
    denyGlobs: file.denyGlobs,
    allowRules: file.allowRules,
    guardrails: file.guardrails,
  }
}

export function publicConfig(cfg: ProviderConfig): PublicProviderConfig {
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    models: normalizeModels(cfg.models, cfg.model),
    dialect: cfg.dialect,
    permissionMode: cfg.permissionMode,
    denyGlobs: cfg.denyGlobs,
    allowRules: cfg.allowRules,
    guardrails: cfg.guardrails,
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
  models?: string[]
  dialect?: 'openai' | 'anthropic'
  permissionMode?: PermissionMode
  denyGlobs?: string[]
  /** Replace allow rules list (empty array clears). */
  allowRules?: string[]
  /** Replace guardrails config (undefined = leave). */
  guardrails?: GuardrailsConfig
}

function guardrailsToToml(g: GuardrailsConfig): TomlTable {
  const t: TomlTable = {
    enabled: g.enabled,
  }
  if (g.applyToInput !== undefined) t.applyToInput = g.applyToInput
  if (g.applyToOutput !== undefined) t.applyToOutput = g.applyToOutput
  if (g.applyToToolResults !== undefined) t.applyToToolResults = g.applyToToolResults
  if (g.rules?.length) {
    t.rules = g.rules.map((rule) => {
      const row: TomlTable = { type: rule.type, strategy: rule.strategy }
      if (rule.pattern) row.pattern = rule.pattern
      return row
    })
  }
  return t
}

function toTomlTable(cfg: ProviderConfig): TomlTable {
  const t: TomlTable = {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey || '',
    model: cfg.model,
    models: normalizeModels(cfg.models, cfg.model),
    dialect: cfg.dialect,
    permissionMode: cfg.permissionMode,
  }
  if (cfg.denyGlobs?.length) t.denyGlobs = cfg.denyGlobs
  if (cfg.allowRules?.length) {
    t.permissions = { allow: cfg.allowRules }
  }
  if (cfg.guardrails) t.guardrails = guardrailsToToml(cfg.guardrails)
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
  const model = patch.model?.trim() || current.model
  const next: ProviderConfig = {
    baseUrl: (patch.baseUrl?.trim() || current.baseUrl).replace(/\/+$/, ''),
    apiKey:
      patch.apiKey !== undefined && patch.apiKey.trim() !== ''
        ? patch.apiKey.trim()
        : current.apiKey,
    model,
    models: normalizeModels(patch.models ?? current.models, model),
    dialect: patch.dialect === 'anthropic' || patch.dialect === 'openai' ? patch.dialect : current.dialect,
    permissionMode: parsePermissionMode(patch.permissionMode) ?? current.permissionMode,
    denyGlobs:
      patch.denyGlobs !== undefined
        ? patch.denyGlobs.filter((g) => typeof g === 'string' && g.trim())
        : current.denyGlobs,
    allowRules:
      patch.allowRules !== undefined ? parseAllowRules(patch.allowRules) : current.allowRules,
    guardrails: patch.guardrails !== undefined ? resolveGuardrailsConfig(patch.guardrails) : current.guardrails,
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
      models: next.models,
      dialect: next.dialect,
      permissionMode: next.permissionMode,
    }
    if (next.denyGlobs?.length) overlay.denyGlobs = next.denyGlobs
    if (next.allowRules?.length) overlay.permissions = { allow: next.allowRules }
    if (next.guardrails) overlay.guardrails = guardrailsToToml(next.guardrails)
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
  if (!cfg.baseUrl?.trim()) {
    throw new Error('No baseUrl — open Settings → Provider')
  }
  if (!cfg.model?.trim()) {
    throw new Error('No model — open Settings → Provider')
  }
  if (!cfg.apiKey?.trim()) {
    throw new Error(
      'No API key. Open Settings or set ENPII_API_KEY / ~/.enpiistudio/config.toml',
    )
  }
}
