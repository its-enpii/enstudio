import type { ChatMessage } from './provider/openai.js'

/**
 * Move cut earlier so we never start a tail mid tool-call chain.
 * Gemini/Antigravity require: user → assistant(tool_calls) → tool* → …
 */
export function toolSafeCutIndex(messages: ChatMessage[], cut: number): number {
  let i = Math.max(0, Math.min(cut, messages.length))
  while (i > 0 && messages[i]?.role === 'tool') i--
  return i
}

/**
 * Repair OpenAI-style history so tool_calls always have matching tool results,
 * and orphan tool rows (after compact / bad persist) are dropped.
 * Required for Gemini via OpenAI-compat gateways.
 */
export function repairChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]!
    if (m.role === 'tool') {
      // Orphan tool result — no preceding assistant tool_calls in out.
      i++
      continue
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const wanted = m.tool_calls
      const byId = new Map<string, ChatMessage>()
      let j = i + 1
      while (j < messages.length && messages[j]!.role === 'tool') {
        const tr = messages[j]!
        const id = tr.tool_call_id
        if (id && wanted.some((tc) => tc.id === id) && !byId.has(id)) byId.set(id, tr)
        j++
      }
      out.push(m)
      for (const tc of wanted) {
        const existing = byId.get(tc.id)
        out.push(
          existing ?? {
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: '[tool result unavailable — context compacted]',
          },
        )
      }
      i = j
      continue
    }
    out.push(m)
    i++
  }
  return out
}
