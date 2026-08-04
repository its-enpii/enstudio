#!/usr/bin/env node
/**
 * Build agent-core then vite (cross-platform, npm-script-shell-safe).
 * Used as the actual implementation behind `npm run build:agent && npm run build:dist`
 * — the `&&` chain breaks on some npm versions on Windows.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentCoreDir = path.resolve(__dirname, '../../agent-core')

// Stage 1: tsc + skills copy
const r1 = spawnSync(process.execPath, [path.resolve(__dirname, 'build-agent.mjs')], {
  cwd: __dirname,
  stdio: 'inherit',
})
if (r1.status !== 0) process.exit(r1.status ?? 1)

// Stage 1.5: Stage the icon
const r15 = spawnSync(process.execPath, [path.resolve(__dirname, 'gen-icon.mjs')], {
  cwd: __dirname,
  stdio: 'inherit',
})
if (r15.status !== 0) process.exit(r15.status ?? 1)

// Stage 2: vite build via the vite module entry (avoids Windows .cmd shim quirks).
const viteCandidates = [
  path.resolve(__dirname, '..', '..', '..', 'node_modules', 'vite', 'bin', 'vite.js'),
  path.resolve(__dirname, '..', '..', '..', 'node_modules', 'vite', 'dist', 'node', 'cli.js'),
]
const viteJs = viteCandidates.find((p) => existsSync(p))
if (!viteJs) {
  console.error('[build] cannot find vite entry in:', viteCandidates)
  process.exit(1)
}

console.log(`[build] vite: ${process.execPath} ${viteJs} build (cwd ${path.resolve(__dirname, '..')})`)
const r2 = spawnSync(process.execPath, [viteJs, 'build'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
})
console.log(`[build] vite exit: ${r2.status} signal: ${r2.signal}`)
if (r2.status !== 0) process.exit(r2.status ?? 1)

console.log('[build] all done')