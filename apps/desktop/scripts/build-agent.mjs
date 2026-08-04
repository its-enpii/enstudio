#!/usr/bin/env node
/**
 * Build the agent-core workspace from inside apps/desktop without going through
 * npm's workspace shell. This avoids a Windows-specific bug where some npm
 * versions resolve the script's literal `run` token as a module path when the
 * workspace is invoked indirectly (e.g. via `run-s -x` or nested `npm run`).
 *
 * 1. Compile TypeScript via the local tsc binary.
 * 2. Copy skills/*.md → dist/skills/*.md (matches agent-core's build script).
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentCoreDir = path.resolve(__dirname, '../../../packages/agent-core')

// 1. Resolve tsc via the typescript module entry (avoids Windows .cmd shim quirks).
const candidates = [
  path.resolve(__dirname, '..', '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'),
  path.resolve(agentCoreDir, 'node_modules', 'typescript', 'bin', 'tsc'),
]
const tscJs = candidates.find((p) => existsSync(p))
if (!tscJs) {
  console.error('[build-agent] cannot find typescript/bin/tsc in:', candidates)
  process.exit(1)
}

console.log(`[build-agent] tsc: ${process.execPath} ${tscJs} (cwd ${agentCoreDir})`)
const tscResult = spawnSync(process.execPath, [tscJs, '-p', 'tsconfig.json'], {
  cwd: agentCoreDir,
  stdio: 'inherit',
})
console.log(`[build-agent] tsc exit: ${tscResult.status} signal: ${tscResult.signal}`)
if (tscResult.status !== 0) process.exit(tscResult.status ?? 1)

// 2. Copy skills → dist/skills.
const skillsSrc = path.join(agentCoreDir, 'skills')
const skillsDst = path.join(agentCoreDir, 'dist', 'skills')
mkdirSync(skillsDst, { recursive: true })
for (const f of readdirSync(skillsSrc)) {
  if (f.endsWith('.md')) copyFileSync(path.join(skillsSrc, f), path.join(skillsDst, f))
}

console.log('[build-agent] done')