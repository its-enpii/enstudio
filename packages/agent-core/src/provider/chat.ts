import { anthropicMessages } from './anthropic.js'
import { chatCompletions, type ChatMessage, type ChatResult, type ToolDef } from './openai.js'

export type ProviderDialect = 'openai' | 'anthropic'

/** Route to OpenAI-compatible or Anthropic Messages API. */
export async function providerChat(opts: {
  dialect?: ProviderDialect
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  stream?: boolean
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onRetry?: (event: {
    attempt: number
    maxAttempts: number
    delayMs: number
    reason: string
  }) => void
  onCircuit?: (event: { state: 'open' | 'half_open' | 'closed'; model: string }) => void
  resilience?: {
    maxAttempts?: number
    baseDelayMs?: number
    circuitFailureThreshold?: number
    circuitCooldownMs?: number
  }
}): Promise<ChatResult> {
  if (opts.dialect === 'anthropic') {
    return anthropicMessages(opts)
  }
  return chatCompletions(opts)
}
