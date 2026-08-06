#!/usr/bin/env node
/**
 * Dev launcher: spawn Electron pointing at dist-electron/main.cjs, watch the
 * Electron sources for changes, and rebuild + restart on every change.
 *
 * Pair with `pnpm dev` (which runs Vite's dev server). Vite sets
 * VITE_DEV_SERVER_URL so the renderer loads from localhost:5173 instead of
 * the bundled dist/ output.
 */
import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..') // → apps/desktop/scripts
const root = resolve(__dirname, '..') // → apps/desktop
const electronEntry = resolve(root, 'dist-electron/main.cjs')
const viteUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
const watched = [
  resolve(root, 'electron/main.ts'),
  resolve(root, 'electron/preload.ts'),
  resolve(root, 'electron/terminal/terminalWorker.ts'),
]

if (!existsSync(electronEntry)) {
  console.error(`[dev-electron] missing ${electronEntry} — run \`pnpm --filter desktop predev\` first`)
  process.exit(1)
}

let electron = null
let restarting = false
let pendingRestart = false

function start() {
  if (electron) return
  const electronCandidates = [
    resolve(root, 'node_modules/electron/dist/electron.exe'),
    resolve(root, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
  ]
  const electronBin = electronCandidates.find((p) => existsSync(p))
  if (!electronBin) {
    console.error('[dev-electron] cannot find electron binary in:', electronCandidates)
    process.exit(1)
  }
  const args = process.platform === 'win32'
    ? [electronEntry]
    : [electronEntry]
  electron = spawn(electronBin, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: viteUrl,
    },
  })
  electron.on('exit', (code) => {
    electron = null
    if (!restarting) {
      console.log(`[dev-electron] exited (code=${code})`)
    }
  })
}

function restart() {
  if (restarting) {
    pendingRestart = true
    return
  }
  restarting = true
  if (electron) {
    electron.once('exit', () => {
      restarting = false
      if (pendingRestart) {
        pendingRestart = false
        restart()
      } else {
        start()
      }
    })
    electron.kill()
  } else {
    restarting = false
    start()
  }
}

async function waitForVite(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok || res.status < 500) return true
    } catch {
      // not yet ready
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

;(async () => {
  console.log(`[dev-electron] waiting for ${viteUrl}`)
  const ready = await waitForVite(viteUrl)
  if (!ready) {
    console.warn(`[dev-electron] vite did not respond at ${viteUrl} after 30s — starting Electron anyway`)
  }
  start()

  for (const file of watched) {
    watch(file, { recursive: false }, () => {
      console.log(`[dev-electron] source changed: ${file} — rebuild via \`pnpm predev\`, then restart`)
      restart()
    })
  }

  process.on('SIGINT', () => {
    if (electron) electron.kill()
    process.exit(0)
  })
})()