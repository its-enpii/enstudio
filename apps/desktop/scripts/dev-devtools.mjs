import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, ENPII_DEVTOOLS: '1' }
const child = spawn('npx', ['vite'], { cwd, env, stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
