/**
 * Deterministic content guardrails (PII / secrets). No LLM classifier.
 * ponytail: model-based policy when false positives force it.
 */

export type GuardStrategy = 'redact' | 'mask' | 'block'
export type PiiType = 'email' | 'credit_card' | 'api_key' | 'private_key' | 'aws_key' | 'custom'
export type GuardSurface = 'input' | 'output' | 'tool'

export interface GuardRule {
  type: PiiType
  strategy: GuardStrategy
  /** Custom regex source (type=custom). */
  pattern?: string
}

export interface GuardrailsConfig {
  enabled: boolean
  applyToInput?: boolean
  applyToOutput?: boolean
  applyToToolResults?: boolean
  rules: GuardRule[]
}

export interface GuardrailsResult {
  text: string
  blocked?: string
  hits: string[]
}

const BUILTIN: Record<Exclude<PiiType, 'custom'>, RegExp> = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  // Rough CC: 13–19 digits with optional separators (false positives OK for MVP redact).
  credit_card: /\b(?:\d[ -]*?){13,19}\b/g,
  api_key:
    /\b(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  private_key:
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  aws_key: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
}

/** Default: redact secrets on tool results + model output; email off (noisy). */
export function defaultGuardrailsConfig(): GuardrailsConfig {
  return {
    enabled: true,
    applyToInput: false,
    applyToOutput: true,
    applyToToolResults: true,
    rules: [
      { type: 'api_key', strategy: 'redact' },
      { type: 'private_key', strategy: 'redact' },
      { type: 'aws_key', strategy: 'redact' },
    ],
  }
}

function maskMatch(raw: string): string {
  if (raw.length <= 4) return '****'
  return `${'*'.repeat(Math.min(raw.length - 4, 24))}${raw.slice(-4)}`
}

function redactLabel(type: PiiType): string {
  return `[REDACTED_${type.toUpperCase()}]`
}

function ruleRegex(rule: GuardRule): RegExp | undefined {
  if (rule.type === 'custom') {
    if (!rule.pattern?.trim()) return undefined
    try {
      return new RegExp(rule.pattern, 'gi')
    } catch {
      return undefined
    }
  }
  const base = BUILTIN[rule.type]
  // Fresh instance each call — global regex lastIndex safety.
  return new RegExp(base.source, base.flags)
}

function surfaceEnabled(cfg: GuardrailsConfig, surface: GuardSurface): boolean {
  if (surface === 'input') return cfg.applyToInput === true
  if (surface === 'output') return cfg.applyToOutput !== false
  return cfg.applyToToolResults !== false
}

export function applyGuardrails(
  text: string,
  cfg: GuardrailsConfig | undefined,
  surface: GuardSurface,
): GuardrailsResult {
  if (!cfg?.enabled || !text || !surfaceEnabled(cfg, surface)) {
    return { text, hits: [] }
  }
  let out = text
  const hits: string[] = []

  for (const rule of cfg.rules) {
    const re = ruleRegex(rule)
    if (!re) continue
    re.lastIndex = 0
    if (rule.strategy === 'block') {
      if (re.test(out)) {
        hits.push(rule.type)
        return {
          text: out,
          blocked: `Blocked by guardrail (${rule.type}) on ${surface}`,
          hits,
        }
      }
      continue
    }
    re.lastIndex = 0
    if (!re.test(out)) continue
    hits.push(rule.type)
    re.lastIndex = 0
    out = out.replace(re, (m) => (rule.strategy === 'mask' ? maskMatch(m) : redactLabel(rule.type)))
  }
  return { text: out, hits }
}

/** Merge partial user config onto defaults (or disable). */
export function resolveGuardrailsConfig(partial?: Partial<GuardrailsConfig> | null): GuardrailsConfig {
  const base = defaultGuardrailsConfig()
  if (!partial || partial.enabled === false) {
    return { ...base, enabled: partial?.enabled === true ? true : partial?.enabled === false ? false : base.enabled, rules: partial?.rules ?? base.rules }
  }
  return {
    enabled: partial.enabled ?? base.enabled,
    applyToInput: partial.applyToInput ?? base.applyToInput,
    applyToOutput: partial.applyToOutput ?? base.applyToOutput,
    applyToToolResults: partial.applyToToolResults ?? base.applyToToolResults,
    rules: partial.rules?.length ? partial.rules : base.rules,
  }
}
