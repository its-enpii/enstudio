import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(root, 'dist/cli.js')

const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

let out = ''
let err = ''
child.stdout.on('data', (d) => {
  out += d.toString()
})
child.stderr.on('data', (d) => {
  err += d.toString()
})

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'health' }) + '\n')

setTimeout(() => {
  child.kill()
  console.log('STDERR:', err.trim())
  console.log('STDOUT:', out.trim())
  if (!out.includes('"ok":true') && !out.includes('"ok": true')) {
    process.exitCode = 1
  }
}, 800)
