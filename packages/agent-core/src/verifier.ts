import type { ProviderConfig } from './config.js'
import { providerChat } from './provider/chat.js'
import type { GoalContract } from './types.js'
import fs from 'node:fs'
import path from 'node:path'

export interface ChangeEvidence {
  path: string
  diff: string
}

export interface CheckEvidence {
  command: string
  ok: boolean
  output: string
}

export interface VerificationResult {
  passed: boolean
  summary: string
  failures: string[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

const VERIFIER_SYSTEM = `You are enpii's independent verifier.
Judge only from the supplied goal, acceptance criteria, final response, and change evidence.
Do not assume unshown tests passed. Return JSON only:
{"passed":boolean,"summary":"short verdict","failures":["specific unmet criterion"]}`

export function goalPrompt(goal: GoalContract): string {
  const criteria = goal.acceptanceCriteria?.length
    ? goal.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '1. The stated goal is fully satisfied without unsupported completion claims.'
  return `Goal: ${goal.goal}\nAcceptance criteria:\n${criteria}`
}

export function discoverVerificationCommands(root: string, explicit?: string[]): string[] {
  if (explicit?.length) return explicit.slice(0, 5)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>
    }
    const scripts = pkg.scripts ?? {}
    for (const name of ['typecheck', 'test', 'build']) {
      if (typeof scripts[name] === 'string' && scripts[name].trim()) return [`npm run ${name}`]
    }
  } catch {
    // No Node project check discovered.
  }
  return []
}

export function parseVerifierResponse(content: string): Omit<VerificationResult, 'usage'> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const value = JSON.parse(cleaned) as Record<string, unknown>
    const failures = Array.isArray(value.failures)
      ? value.failures.filter((item): item is string => typeof item === 'string').slice(0, 10)
      : []
    if (typeof value.passed !== 'boolean') throw new Error('passed missing')
    return {
      passed: value.passed,
      summary: typeof value.summary === 'string' && value.summary.trim()
        ? value.summary.trim().slice(0, 500)
        : value.passed ? 'Verification passed' : 'Verification failed',
      failures,
    }
  } catch {
    return {
      passed: false,
      summary: 'Verifier returned invalid JSON',
      failures: [content.trim().slice(0, 500) || 'Empty verifier response'],
    }
  }
}

export async function verifyGoal(opts: {
  goal: GoalContract
  finalText: string
  changes: ChangeEvidence[]
  checks?: CheckEvidence[]
  config: ProviderConfig
  signal?: AbortSignal
  onRetry?: (event: {
    attempt: number
    maxAttempts: number
    delayMs: number
    reason: string
  }) => void
  onCircuit?: (event: { state: 'open' | 'half_open' | 'closed'; model: string }) => void
}): Promise<VerificationResult> {
  const evidence = opts.changes.length
    ? opts.changes.slice(-20).map((change) => `FILE: ${change.path}\n${change.diff}`).join('\n\n')
    : '(no successful write_file/edit_file evidence)'
  const checks = opts.checks?.length
    ? opts.checks.map((check) => `COMMAND: ${check.command}\nRESULT: ${check.ok ? 'PASS' : 'FAIL'}\n${check.output}`).join('\n\n')
    : '(no project checks configured or discovered)'
  const prompt = `${goalPrompt(opts.goal)}\n\nCandidate response:\n${opts.finalText || '(empty)'}\n\nProject checks:\n${checks}\n\nChange evidence:\n${evidence}`.slice(0, 30_000)
  const result = await providerChat({
    dialect: opts.config.dialect,
    baseUrl: opts.config.baseUrl,
    apiKey: opts.config.apiKey,
    model: opts.config.model,
    messages: [
      { role: 'system', content: VERIFIER_SYSTEM },
      { role: 'user', content: prompt },
    ],
    stream: false,
    signal: opts.signal,
    onRetry: opts.onRetry,
    onCircuit: opts.onCircuit,
  })
  return { ...parseVerifierResponse(result.content), usage: result.usage }
}
