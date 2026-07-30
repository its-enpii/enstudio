/**
 * Normalize provider usage blobs (OpenAI / Anthropic / gateways).
 * Goal: one shape for loop + session + UI — including cache when reported.
 */

export type NormalizedUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** Tokens served from cache (subset of prompt, when provider reports). */
  cached_tokens: number
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Pull cached count from common OpenAI/Anthropic/gateway fields. */
function extractCached(raw: Record<string, unknown>): number {
  const direct =
    num(raw.cached_tokens) ||
    num(raw.cache_read_input_tokens) ||
    num(raw.cache_read_tokens) ||
    num(raw.cached)
  if (direct) return direct

  const details = raw.prompt_tokens_details
  if (details && typeof details === 'object') {
    const d = details as Record<string, unknown>
    const fromDetails = num(d.cached_tokens) || num(d.cached) || num(d.cache_read_tokens)
    if (fromDetails) return fromDetails
  }

  const inputDetails = raw.input_tokens_details
  if (inputDetails && typeof inputDetails === 'object') {
    const d = inputDetails as Record<string, unknown>
    const fromIn = num(d.cached_tokens) || num(d.cache_read)
    if (fromIn) return fromIn
  }

  return 0
}

/**
 * Accept OpenAI-style, Anthropic-style, or already-normalized usage.
 * Returns undefined if nothing usable.
 */
export function normalizeUsage(raw: unknown): NormalizedUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>

  const prompt =
    num(u.prompt_tokens) ||
    num(u.input_tokens) ||
    num(u.prompt) ||
    num(u.input)
  const completion =
    num(u.completion_tokens) ||
    num(u.output_tokens) ||
    num(u.completion) ||
    num(u.output)
  let total = num(u.total_tokens) || num(u.total)
  if (!total && (prompt || completion)) total = prompt + completion
  if (!prompt && !completion && !total) return undefined

  const cached = Math.min(extractCached(u), prompt || total)
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total || prompt + completion,
    cached_tokens: cached,
  }
}

export function addNormalizedUsage(
  a?: NormalizedUsage,
  b?: NormalizedUsage,
): NormalizedUsage | undefined {
  if (!a && !b) return undefined
  if (!a) return b
  if (!b) return a
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cached_tokens: a.cached_tokens + b.cached_tokens,
  }
}

/** Fresh (non-cached) input estimate for display / rough cost. */
export function freshPromptTokens(u: NormalizedUsage): number {
  return Math.max(0, u.prompt_tokens - u.cached_tokens)
}
