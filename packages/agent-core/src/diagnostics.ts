import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveInRoot } from './tools/paths.js'

export interface ProjectDiagnostic {
  path: string
  line: number
  column: number
  severity: 'error' | 'warning'
  source: 'typescript' | 'eslint' | 'php' | 'python'
  code?: string
  message: string
}

function run(command: string, args: string[], cwd: string): { output: string; missing: boolean } {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
  return { output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(), missing: Boolean(result.error && 'code' in result.error && result.error.code === 'ENOENT') }
}

function relative(root: string, file: string): string {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join('/')
}

function nearestFile(root: string, start: string, name: string): string | undefined {
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

function typescriptDiagnostics(root: string, relPath?: string): ProjectDiagnostic[] {
  if (relPath && !/\.[cm]?[jt]sx?$/.test(relPath)) return []
  const start = relPath ? path.dirname(resolveInRoot(root, relPath)) : root
  const config = nearestFile(root, start, 'tsconfig.json')
  if (!config) return []
  const configDir = path.dirname(config)
  const binary = nearestFile(root, configDir, path.join('node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'))
  const result = run(binary ?? 'tsc', ['--project', config, '--noEmit', '--pretty', 'false'], configDir)
  if (result.missing) return []
  const diagnostics: ProjectDiagnostic[] = []
  for (const line of result.output.split(/\r?\n/)) {
    const match = line.match(/^(.*?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/)
    if (!match) continue
    diagnostics.push({
      path: relative(root, path.resolve(configDir, match[1])),
      line: Number(match[2]),
      column: Number(match[3]),
      severity: match[4] as 'error' | 'warning',
      source: 'typescript' as const,
      code: match[5],
      message: match[6],
    })
  }
  return diagnostics
}

function eslintDiagnostics(root: string, relPath?: string): ProjectDiagnostic[] {
  if (!relPath || !/\.[cm]?[jt]sx?$/.test(relPath)) return []
  const file = resolveInRoot(root, relPath)
  const configDir = path.dirname(file)
  const binary = nearestFile(root, configDir, path.join('node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint'))
  if (!binary) return []
  const result = run(binary, ['--format', 'json', '--no-error-on-unmatched-pattern', file], configDir)
  if (!result.output) return []
  let rows: Array<{ filePath?: string; messages?: Array<{ line?: number; column?: number; severity?: number; ruleId?: string; message?: string }> }>
  try {
    const start = result.output.indexOf('[')
    const end = result.output.lastIndexOf(']')
    rows = JSON.parse(start >= 0 && end >= start ? result.output.slice(start, end + 1) : result.output) as typeof rows
  } catch { return [] }
  return rows.flatMap((row) => (row.messages ?? []).map((message) => ({
    path: relative(root, row.filePath ?? file),
    line: message.line ?? 1,
    column: message.column ?? 1,
    severity: message.severity === 1 ? 'warning' as const : 'error' as const,
    source: 'eslint' as const,
    code: message.ruleId ?? undefined,
    message: message.message ?? 'ESLint issue',
  })))
}

function phpDiagnostics(root: string, relPath: string): ProjectDiagnostic[] {
  if (!relPath.endsWith('.php') || relPath.endsWith('.blade.php')) return []
  const file = resolveInRoot(root, relPath)
  const result = run('php', ['-l', file], root)
  if (result.missing || /No syntax errors detected/i.test(result.output)) return []
  const match = result.output.match(/(?:Parse|Fatal) error:\s*(.+?)\s+in\s+.+?\s+on line\s+(\d+)/i)
  return [{ path: relPath, line: Number(match?.[2] ?? 1), column: 1, severity: 'error', source: 'php', message: match?.[1] ?? result.output }]
}

function pythonDiagnostics(root: string, relPath: string): ProjectDiagnostic[] {
  if (!relPath.endsWith('.py')) return []
  const file = resolveInRoot(root, relPath)
  const script = 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])'
  const result = run('python3', ['-c', script, file], root)
  if (result.missing || !result.output) return []
  const line = Number(result.output.match(/line\s+(\d+)/)?.[1] ?? 1)
  const message = result.output.split(/\r?\n/).reverse().find((value: string) => /(?:Syntax|Indentation|Tab)Error:/.test(value))?.trim() ?? result.output
  return [{ path: relPath, line, column: 1, severity: 'error', source: 'python', message }]
}

export function projectDiagnostics(root: string, relPath?: string): ProjectDiagnostic[] {
  const projectRoot = path.resolve(root)
  const file = relPath?.trim().replace(/\\/g, '/')
  if (file) resolveInRoot(projectRoot, file)
  return [...typescriptDiagnostics(projectRoot, file), ...eslintDiagnostics(projectRoot, file), ...(file ? phpDiagnostics(projectRoot, file) : []), ...(file ? pythonDiagnostics(projectRoot, file) : [])]
}
