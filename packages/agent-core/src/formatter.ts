import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveInRoot } from './tools/paths.js'

export interface FormatResult {
  content: string
  formatter: string
}

function nearest(root: string, start: string, name: string): string | undefined {
  let dir = path.resolve(start)
  const boundary = path.resolve(root)
  while (dir === boundary || dir.startsWith(`${boundary}${path.sep}`)) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) return candidate
    if (dir === boundary) break
    dir = path.dirname(dir)
  }
  return undefined
}

export function formatProjectFile(root: string, relPath: string, content: string): FormatResult {
  const projectRoot = path.resolve(root)
  const file = relPath.trim().replace(/\\/g, '/')
  const absolute = resolveInRoot(projectRoot, file)
  const prettier = nearest(projectRoot, path.dirname(absolute), path.join('node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier'))
  if (prettier) {
    const result = spawnSync(prettier, ['--stdin-filepath', absolute], {
      cwd: path.dirname(absolute),
      input: content,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    })
    if (result.status === 0 && typeof result.stdout === 'string') return { content: result.stdout, formatter: 'Prettier' }
    throw new Error((result.stderr || result.stdout || 'Formatter failed').trim())
  }

  if (/\.json$/i.test(file)) {
    try { return { content: `${JSON.stringify(JSON.parse(content), null, 2)}\n`, formatter: 'JSON' } } catch { throw new Error('Invalid JSON; cannot format') }
  }
  return { content: content.replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n'), formatter: 'Basic whitespace' }
}
