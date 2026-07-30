/**
 * Normalize ask_user options: plain strings or { label, description?, recommended? }.
 * Max 6 choices. Labels are what the model receives when the user picks one.
 */

export type AskOption = {
  label: string
  description?: string
  recommended?: boolean
}

const MAX_OPTS = 6
const MAX_LABEL = 160
const MAX_DESC = 280

export function normalizeAskOptions(raw: unknown): AskOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: AskOption[] = []
  for (const item of raw) {
    if (out.length >= MAX_OPTS) break
    if (typeof item === 'string') {
      const label = item.trim().slice(0, MAX_LABEL)
      if (label) out.push({ label })
      continue
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const label = String(o.label ?? o.title ?? o.value ?? o.text ?? '')
        .trim()
        .slice(0, MAX_LABEL)
      if (!label) continue
      const description = String(o.description ?? o.detail ?? o.blurb ?? '')
        .trim()
        .slice(0, MAX_DESC)
      const recommended =
        o.recommended === true ||
        o.recommended === 'true' ||
        o.isRecommended === true ||
        o.default === true
      out.push({
        label,
        description: description || undefined,
        recommended: recommended || undefined,
      })
    }
  }
  return out.length ? out : undefined
}
