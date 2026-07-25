import fs from 'node:fs'
import path from 'node:path'
import { isDir, isFile, resolveInRoot, shouldSkipDir, toRel } from './paths.js'
import type { ToolName } from './defs.js'

const DEFAULT_READ = 120_000
const DEFAULT_GLOB = 200
const DEFAULT_GREP = 50
const MAX_WRITE = 500_000

export interface ToolResult {
  ok: boolean
  summary: string
  content: string
}

function ok(summary: string, content: string): ToolResult {
  return { ok: true, summary, content }
}

function fail(message: string): ToolResult {
  return { ok: false, summary: message, content: message }
}

export async function runTool(
  root: string,
  name: string,
  argsJson: string,
): Promise<ToolResult> {
  let args: Record<string, unknown> = {}
  try {
    args = argsJson?.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
  } catch {
    return fail(`invalid tool args JSON: ${argsJson.slice(0, 120)}`)
  }

  try {
    switch (name as ToolName) {
      case 'list_dir':
        return listDir(root, String(args.path ?? '.'))
      case 'read_file':
        return readFile(
          root,
          String(args.path ?? ''),
          typeof args.maxBytes === 'number' ? args.maxBytes : DEFAULT_READ,
        )
      case 'glob':
        return globFiles(
          root,
          String(args.pattern ?? ''),
          typeof args.maxResults === 'number' ? args.maxResults : DEFAULT_GLOB,
        )
      case 'grep':
        return grepFiles(root, {
          pattern: String(args.pattern ?? ''),
          path: String(args.path ?? '.'),
          regex: Boolean(args.regex),
          maxResults: typeof args.maxResults === 'number' ? args.maxResults : DEFAULT_GREP,
        })
      case 'write_file':
        return writeFileTool(root, String(args.path ?? ''), String(args.content ?? ''))
      case 'edit_file':
        return editFileTool(
          root,
          String(args.path ?? ''),
          String(args.old_string ?? ''),
          String(args.new_string ?? ''),
        )
      default:
        return fail(`unknown tool: ${name}`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

/** Line-based unified hunk (prefix/suffix context, no full LCS). */
export function unifiedLineDiff(oldText: string, newText: string, path: string): string {
  const a = oldText.split(/\r?\n/)
  const b = newText.split(/\r?\n/)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (
    j < a.length - i &&
    j < b.length - i &&
    a[a.length - 1 - j] === b[b.length - 1 - j]
  ) {
    j++
  }

  const ctx = 2
  const preStart = Math.max(0, i - ctx)
  const lines: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${preStart + 1},${Math.max(1, a.length - j - preStart)} +${preStart + 1},${Math.max(1, b.length - j - preStart)} @@`,
  ]
  for (let k = preStart; k < i; k++) lines.push(` ${a[k] ?? ''}`)
  for (let k = i; k < a.length - j; k++) lines.push(`-${a[k] ?? ''}`)
  for (let k = i; k < b.length - j; k++) lines.push(`+${b[k] ?? ''}`)
  for (let k = a.length - j; k < Math.min(a.length, a.length - j + ctx); k++) {
    lines.push(` ${a[k] ?? ''}`)
  }
  // cap size for UI
  const body = lines.join('\n')
  return body.length > 4000 ? `${body.slice(0, 4000)}\n…` : body
}

/** Human-readable preview for approval UI (does not write). */
export function previewWriteTool(
  root: string,
  name: string,
  argsJson: string,
): { summary: string; preview: string } {
  let args: Record<string, unknown> = {}
  try {
    args = argsJson?.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
  } catch {
    return { summary: name, preview: argsJson.slice(0, 400) }
  }
  if (name === 'write_file') {
    const rel = String(args.path ?? '')
    const content = String(args.content ?? '')
    let prev = ''
    let exists = false
    try {
      const abs = resolveInRoot(root, rel)
      if (isFile(abs)) {
        exists = true
        const st = fs.statSync(abs)
        if (st.size <= MAX_WRITE) {
          const buf = fs.readFileSync(abs)
          if (!buf.includes(0)) prev = buf.toString('utf8')
        }
      }
    } catch {
      /* ignore */
    }
    const preview = exists
      ? unifiedLineDiff(prev, content, rel || 'file')
      : unifiedLineDiff('', content, rel || 'file')
    return {
      summary: `write_file ${rel} (${content.length} chars, ${exists ? 'overwrite' : 'create'})`,
      preview,
    }
  }
  if (name === 'edit_file') {
    const rel = String(args.path ?? '')
    const oldS = String(args.old_string ?? '')
    const newS = String(args.new_string ?? '')
    return {
      summary: `edit_file ${rel}`,
      preview: unifiedLineDiff(oldS, newS, rel || 'file'),
    }
  }
  return { summary: name, preview: argsJson.slice(0, 400) }
}

function writeFileTool(root: string, rel: string, content: string): ToolResult {
  if (!rel) return fail('path required')
  if (content.length > MAX_WRITE) return fail(`content too large (>${MAX_WRITE} chars)`)
  const abs = resolveInRoot(root, rel)
  const dir = path.dirname(abs)
  fs.mkdirSync(dir, { recursive: true })
  const existed = isFile(abs)
  fs.writeFileSync(abs, content, 'utf8')
  const action = existed ? 'overwrote' : 'created'
  return ok(`write_file ${rel} (${action}, ${content.length} chars)`, `${action} ${rel}`)
}

function editFileTool(
  root: string,
  rel: string,
  oldString: string,
  newString: string,
): ToolResult {
  if (!rel) return fail('path required')
  if (!oldString) return fail('old_string required')
  const abs = resolveInRoot(root, rel)
  if (!isFile(abs)) return fail(`not a file: ${rel}`)
  const text = fs.readFileSync(abs, 'utf8')
  if (text.includes('\0')) return fail(`binary file refused: ${rel}`)

  // Match ignoring CRLF vs LF (Windows files + model often disagree).
  const crlf = text.includes('\r\n')
  const norm = (s: string) => s.replace(/\r\n/g, '\n')
  const textN = norm(text)
  const oldN = norm(oldString)
  const newN = norm(newString)

  const count = textN.split(oldN).length - 1
  if (count === 0) return fail(`old_string not found in ${rel}`)
  if (count > 1) return fail(`old_string matches ${count} times in ${rel} — must be unique`)

  let next = textN.replace(oldN, newN)
  if (crlf) next = next.replace(/\n/g, '\r\n')
  if (next.length > MAX_WRITE) return fail(`result too large (>${MAX_WRITE} chars)`)
  fs.writeFileSync(abs, next, 'utf8')
  return ok(
    `edit_file ${rel} (${oldString.length}→${newString.length} chars)`,
    `edited ${rel}`,
  )
}

function listDir(root: string, rel: string): ToolResult {
  const abs = resolveInRoot(root, rel || '.')
  if (!isDir(abs)) return fail(`not a directory: ${rel}`)
  const entries = fs.readdirSync(abs, { withFileTypes: true })
  const lines = entries
    .filter((e) => !shouldSkipDir(e.name))
    .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
    .sort()
  return ok(`list_dir ${rel || '.'} (${lines.length})`, lines.join('\n') || '(empty)')
}

function readFile(root: string, rel: string, maxBytes: number): ToolResult {
  if (!rel) return fail('path required')
  const abs = resolveInRoot(root, rel)
  if (!isFile(abs)) return fail(`not a file: ${rel}`)
  const stat = fs.statSync(abs)
  const buf = Buffer.alloc(Math.min(stat.size, maxBytes + 1))
  const fd = fs.openSync(abs, 'r')
  try {
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const slice = buf.subarray(0, Math.min(n, maxBytes))
    if (slice.includes(0)) return fail(`binary file refused: ${rel}`)
    const text = slice.toString('utf8')
    const truncated = n > maxBytes || stat.size > maxBytes
    const body = truncated
      ? `${text}\n\n… truncated (${stat.size} bytes, showed ${maxBytes})`
      : text
    return ok(`read_file ${rel} (${stat.size}b)`, body)
  } finally {
    fs.closeSync(fd)
  }
}

function globToRegExp(pattern: string): RegExp {
  // very small glob: ** * ?
  let i = 0
  let out = '^'
  const p = pattern.replace(/\\/g, '/')
  while (i < p.length) {
    const c = p[i]
    if (c === '*' && p[i + 1] === '*') {
      out += '.*'
      i += 2
      if (p[i] === '/') i++
      continue
    }
    if (c === '*') {
      out += '[^/]*'
      i++
      continue
    }
    if (c === '?') {
      out += '[^/]'
      i++
      continue
    }
    if ('+^$()[]{}|.'.includes(c)) out += `\\${c}`
    else out += c
    i++
  }
  out += '$'
  return new RegExp(out)
}

function walkFiles(root: string, dir: string, out: string[], max: number): void {
  if (out.length >= max) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= max) return
    if (e.name.startsWith('.') && e.name !== '.env.example') {
      if (e.name === '.git' || e.name === '.enpii') continue
    }
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name)) continue
      walkFiles(root, path.join(dir, e.name), out, max)
    } else if (e.isFile()) {
      out.push(path.join(dir, e.name))
    }
  }
}

function globFiles(root: string, pattern: string, maxResults: number): ToolResult {
  if (!pattern) return fail('pattern required')
  const re = globToRegExp(pattern.startsWith('**/') ? pattern : `**/${pattern}`)
  const rootAbs = path.resolve(root)
  const files: string[] = []
  walkFiles(rootAbs, rootAbs, files, 50_000)
  const hits: string[] = []
  for (const f of files) {
    const rel = toRel(rootAbs, f)
    if (re.test(rel) || re.test(rel.split('/').pop() ?? '')) {
      hits.push(rel)
      if (hits.length >= maxResults) break
    }
  }
  return ok(`glob ${pattern} (${hits.length})`, hits.join('\n') || '(no matches)')
}

function grepFiles(
  root: string,
  opts: { pattern: string; path: string; regex: boolean; maxResults: number },
): ToolResult {
  if (!opts.pattern) return fail('pattern required')
  let re: RegExp
  try {
    re = opts.regex
      ? new RegExp(opts.pattern, 'i')
      : new RegExp(opts.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  } catch (err) {
    return fail(`bad regex: ${err instanceof Error ? err.message : String(err)}`)
  }

  const start = resolveInRoot(root, opts.path || '.')
  const rootAbs = path.resolve(root)
  const files: string[] = []
  if (isFile(start)) files.push(start)
  else walkFiles(rootAbs, start, files, 20_000)

  const lines: string[] = []
  for (const f of files) {
    if (lines.length >= opts.maxResults) break
    let text: string
    try {
      const st = fs.statSync(f)
      if (st.size > 1_000_000) continue
      const buf = fs.readFileSync(f)
      if (buf.includes(0)) continue
      text = buf.toString('utf8')
    } catch {
      continue
    }
    const rel = toRel(rootAbs, f)
    const split = text.split(/\r?\n/)
    for (let i = 0; i < split.length; i++) {
      if (lines.length >= opts.maxResults) break
      if (re.test(split[i]!)) {
        lines.push(`${rel}:${i + 1}:${split[i]!.slice(0, 240)}`)
      }
    }
  }
  return ok(`grep ${opts.pattern} (${lines.length})`, lines.join('\n') || '(no matches)')
}
