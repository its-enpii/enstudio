#!/usr/bin/env node
/**
 * Cross-platform dev launcher: spawn vite + Electron concurrently and stream
 * both stdout/stderr to this terminal. Replaces `run-p` from npm-run-all which
 * isn't installed in this workspace.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const procs = [
  { name: 'vite', cmd: process.execPath, args: [path.join(root, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js')], cwd: root, color: 36 },
  { name: 'electron', cmd: process.execPath, args: [path.join(__dirname, 'dev-electron.mjs')], cwd: root, color: 33 },
]

for (const p of procs) {
  const child = spawn(p.cmd, p.args, { cwd: p.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  const prefix = `\x1b[1;${p.color}m[${p.name}]\x1b[0m `
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8').replace(/\r?\n/g, `\n${prefix}`)
    process.stdout.write(`${prefix}${text}\n`)
  })
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').replace(/\r?\n/g, `\n${prefix}`)
    process.stderr.write(`${prefix}${text}\n`)
  })
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited (code=${code})\n`)
  })
}

const shutdown = () => {
  for (const child of (shutdown.children ?? [])) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
setInterval(() => {}, 1 << 30)
