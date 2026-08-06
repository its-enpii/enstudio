#!/usr/bin/env node
/**
 * Bundle the three Electron-side scripts into dist-electron/:
 *   - main.cjs          (Node.js entry loaded by Electron)
 *   - preload.cjs       (contextBridge target loaded by BrowserWindow)
 *   - terminalWorker.cjs (utilityProcess.fork target)
 *
 * Each is bundled via its own vite config because they share no rollup
 * options and producing one bundle per script keeps output deterministic.
 *
 * In dev mode VITE_DEV_SERVER_URL is baked into main.cjs at build time so
 * the bundle knows to load the renderer from the vite dev server.
 */
import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const entries = [
  { src: 'electron/main.ts', config: 'vite.config.main.mjs' },
  { src: 'electron/terminal/terminalWorker.ts', config: 'vite.config.terminalWorker.mjs' },
  { src: 'electron/preload.ts', config: 'vite.config.preload.mjs' },
]
const watchMode = process.argv.includes('--watch')

const missing = entries.map((e) => path.join(root, e.src)).filter((p) => !existsSync(p))
if (missing.length) {
  console.error(`[build-electron-extras] missing entries: ${missing.join(', ')}`)
  process.exit(1)
}

function runBuild(configPath, env = process.env) {
  return new Promise((resolve, reject) => {
    const viteCandidates = [
      path.join(root, '..', 'node_modules', 'vite', 'bin', 'vite.js'),
      path.join(root, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js'),
    ]
    const viteJs = viteCandidates.find((p) => existsSync(p))
    if (!viteJs) {
      reject(new Error(`vite not found in: ${viteCandidates.join(', ')}`))
      return
    }
    const child = spawn(
      process.execPath,
      [viteJs, 'build', '--config', configPath],
      { stdio: 'inherit', cwd: root, env },
    )
    child.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`vite exit ${code}`))))
  })
}

let running = false
let queued = false
async function runOnce() {
  if (running) {
    queued = true
    return
  }
  running = true
  try {
    // Bake VITE_DEV_SERVER_URL into main.cjs so Electron can load the
    // renderer from the vite dev server. Production builds keep this
    // undefined so Electron loads dist/index.html instead.
    const buildEnv = {
      ...process.env,
      VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173',
    }
    for (const e of entries) {
      await runBuild(path.join(root, e.config), buildEnv)
    }
  } finally {
    running = false
    if (queued) {
      queued = false
      runOnce().catch(() => {})
    }
  }
}

runOnce()
  .then(() => {
    if (!watchMode) process.exit(0)
    console.log('[build-electron-extras] watching for changes')
    for (const e of entries) {
      watch(path.join(root, e.src), { recursive: false }, () => {
        console.log(`[build-electron-extras] ${e.src} changed, rebuilding`)
        runOnce().catch((err) => console.error('[build-electron-extras]', err))
      })
    }
    setInterval(() => {}, 1 << 30)
  })
  .catch((err) => {
    console.error('[build-electron-extras] failed', err)
    process.exit(1)
  })