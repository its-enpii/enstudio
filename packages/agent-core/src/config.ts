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

export type VendorKind = 'enpii' | 'claude' | 'codex' | 'opencode' | 'gemini'

export interface SingleVendorConfig {
  baseUrl: string
  apiKey: string
  model: string
  models: string[]
  dialect: 'openai' | 'anthropic'
  sonnetModel?: string
  haikuModel?: string
  opusModel?: string
  maxThinkingTokens?: string
  customModelEnv?: string
  customCliFlags?: string
}

export interface VendorPairConfig {
  main: SingleVendorConfig
  subagent?: SingleVendorConfig
}

export type VendorsConfig = Partial<Record<VendorKind | string, VendorPairConfig>>

export type PublicSingleVendorConfig = Omit<SingleVendorConfig, 'apiKey'> & { hasKey: boolean }
export type PublicVendorPairConfig = {
  main: PublicSingleVendorConfig
  subagent?: PublicSingleVendorConfig
}
export type PublicVendorsConfig = Partial<Record<VendorKind | string, PublicVendorPairConfig>>

export const DEFAULT_VENDORS: Record<VendorKind, VendorPairConfig> = {
  enpii: {
    main: { baseUrl: '', apiKey: '', model: '', models: [], dialect: 'openai' },
    subagent: { baseUrl: '', apiKey: '', model: 'gpt-5.4-mini', models: ['gpt-5.4-mini', 'gpt-5.4'], dialect: 'openai' },
  },
  claude: {
    main: { baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-3-7-sonnet', models: ['claude-3-7-sonnet', 'claude-3-5-haiku', 'claude-3-5-sonnet'], dialect: 'anthropic' },
    subagent: { baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-3-5-haiku', models: ['claude-3-5-haiku', 'claude-3-7-sonnet'], dialect: 'anthropic' },
  },
  codex: {
    main: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4', models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'], dialect: 'openai' },
    subagent: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4-mini', models: ['gpt-5.4-mini', 'gpt-5.4'], dialect: 'openai' },
  },
  opencode: {
    main: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4', models: ['gpt-5.4', 'gpt-5.4-mini'], dialect: 'openai' },
    subagent: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4-mini', models: ['gpt-5.4-mini'], dialect: 'openai' },
  },
  gemini: {
    main: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: '', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], dialect: 'openai' },
    subagent: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: '', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash'], dialect: 'openai' },
  },
}

export interface ProviderConfig {
  vendors?: VendorsConfig
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
  vendors?: PublicVendorsConfig
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


function parseVendorsFromToml(table: TomlTable): VendorsConfig | undefined {
  const vendors: VendorsConfig = {}
  for (const key of Object.keys(table)) {
    const match = /^vendors\.([^.]+)\.(main|subagent)$/.exec(key)
    if (!match) continue
    const [, vendorName, target] = match
    const sec = table[key]
    if (!sec || typeof sec !== "object" || Array.isArray(sec)) continue
    const secTable = sec as TomlTable
    const baseUrl = tomlString(secTable, "baseUrl", "base_url") ?? ""
    const apiKey = tomlString(secTable, "apiKey", "api_key") ?? ""
    const model = tomlString(secTable, "model") ?? ""
    const modelsArr = tomlStringArray(secTable, "models") ?? tomlStringArray(secTable, "model_list")
    const dialectRaw = tomlString(secTable, "dialect", "api_dialect")
    const dialect = dialectRaw === "anthropic" || dialectRaw === "openai" ? dialectRaw : "openai"
    const sonnetModel = tomlString(secTable, "sonnetModel", "sonnet_model")
    const haikuModel = tomlString(secTable, "haikuModel", "haiku_model")
    const opusModel = tomlString(secTable, "opusModel", "opus_model")
    const maxThinkingTokens = tomlString(secTable, "maxThinkingTokens", "max_thinking_tokens")
    const customModelEnv = tomlString(secTable, "customModelEnv", "custom_model_env")
    const customCliFlags = tomlString(secTable, "customCliFlags", "custom_cli_flags")

    const single: SingleVendorConfig = {
      baseUrl,
      apiKey,
      model,
      models: normalizeModels(modelsArr, model),
      dialect,
      sonnetModel,
      haikuModel,
      opusModel,
      maxThinkingTokens,
      customModelEnv,
      customCliFlags,
    }
    const currentPair = vendors[vendorName!] ?? { main: { baseUrl: "", apiKey: "", model: "", models: [], dialect: "openai" } }
    if (target === "main") {
      currentPair.main = single
    } else if (target === "subagent") {
      currentPair.subagent = single
    }
    vendors[vendorName!] = currentPair
  }
  return Object.keys(vendors).length ? vendors : undefined
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
    const parsed = parseToml(raw)
    return { ...partialFromToml(parsed), vendors: parseVendorsFromToml(parsed) }
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
    if (p.vendors !== undefined) out.vendors = p.vendors
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
    vendors: file.vendors,
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
  vendors?: VendorsConfig
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
  if (cfg.vendors) {
    for (const [vName, vConfig] of Object.entries(cfg.vendors)) {
      if (!vConfig) continue
      if (vConfig.main) {
        t[`vendors.${vName}.main`] = {
          baseUrl: vConfig.main.baseUrl,
          apiKey: vConfig.main.apiKey || '',
          model: vConfig.main.model,
          models: normalizeModels(vConfig.main.models, vConfig.main.model),
          dialect: vConfig.main.dialect,
          ...(vConfig.main.sonnetModel ? { sonnetModel: vConfig.main.sonnetModel } : {}),
          ...(vConfig.main.haikuModel ? { haikuModel: vConfig.main.haikuModel } : {}),
          ...(vConfig.main.opusModel ? { opusModel: vConfig.main.opusModel } : {}),
          ...(vConfig.main.maxThinkingTokens ? { maxThinkingTokens: vConfig.main.maxThinkingTokens } : {}),
          ...(vConfig.main.customModelEnv ? { customModelEnv: vConfig.main.customModelEnv } : {}),
          ...(vConfig.main.customCliFlags ? { customCliFlags: vConfig.main.customCliFlags } : {}),
        }
      }
      if (vConfig.subagent) {
        t[`vendors.${vName}.subagent`] = {
          baseUrl: vConfig.subagent.baseUrl,
          apiKey: vConfig.subagent.apiKey || '',
          model: vConfig.subagent.model,
          models: normalizeModels(vConfig.subagent.models, vConfig.subagent.model),
          dialect: vConfig.subagent.dialect,
          ...(vConfig.subagent.sonnetModel ? { sonnetModel: vConfig.subagent.sonnetModel } : {}),
          ...(vConfig.subagent.haikuModel ? { haikuModel: vConfig.subagent.haikuModel } : {}),
          ...(vConfig.subagent.opusModel ? { opusModel: vConfig.subagent.opusModel } : {}),
          ...(vConfig.subagent.maxThinkingTokens ? { maxThinkingTokens: vConfig.subagent.maxThinkingTokens } : {}),
          ...(vConfig.subagent.customModelEnv ? { customModelEnv: vConfig.subagent.customModelEnv } : {}),
          ...(vConfig.subagent.customCliFlags ? { customCliFlags: vConfig.subagent.customCliFlags } : {}),
        }
      }
    }
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
    vendors: patch.vendors !== undefined ? patch.vendors : current.vendors,
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

export function getVendorProvider(
  cfg: ProviderConfig,
  vendor: string = 'enpii',
  target: 'main' | 'subagent' = 'main',
): SingleVendorConfig {
  const v = cfg.vendors?.[vendor]
  const targetConfig = target === 'subagent' ? (v?.subagent ?? v?.main) : v?.main
  const rootAsSingle: SingleVendorConfig = {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    models: cfg.models,
    dialect: cfg.dialect,
  }
  const def = DEFAULT_VENDORS[vendor as VendorKind]
  const base = target === 'subagent' ? (def?.subagent ?? def?.main ?? rootAsSingle) : (def?.main ?? rootAsSingle)

  if (!targetConfig) {
    return {
      baseUrl: base.baseUrl || rootAsSingle.baseUrl,
      apiKey: base.apiKey || rootAsSingle.apiKey,
      model: base.model || rootAsSingle.model,
      models: base.models?.length ? base.models : rootAsSingle.models,
      dialect: base.dialect || rootAsSingle.dialect,
    }
  }

  return {
    baseUrl: targetConfig.baseUrl?.trim() || v?.main?.baseUrl?.trim() || rootAsSingle.baseUrl,
    apiKey: targetConfig.apiKey?.trim() || v?.main?.apiKey?.trim() || rootAsSingle.apiKey,
    model: targetConfig.model?.trim() || v?.main?.model?.trim() || rootAsSingle.model,
    models: targetConfig.models?.length ? targetConfig.models : rootAsSingle.models,
    dialect: targetConfig.dialect || v?.main?.dialect || rootAsSingle.dialect,
  }
}

export function getVendorSubagentProvider(cfg: ProviderConfig, vendor: string = 'enpii'): ProviderConfig {
  const sub = getVendorProvider(cfg, vendor, 'subagent')
  return {
    ...cfg,
    baseUrl: sub.baseUrl,
    apiKey: sub.apiKey,
    model: sub.model,
    models: sub.models,
    dialect: sub.dialect,
  }
}
