import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectHash } from './persist.js'

export interface SkillCatalogEntry {
  name: string
  description: string
  source: 'project' | 'global'
  path: string
}

export interface LoadedSkill {
  name: string
  body: string
}

export interface ProjectContext {
  projectInstructions?: string
  /** Compact auto map of layout/scripts/stack for chat-default path. */
  projectSnapshot?: string
  /** Capped excerpts from ~/.enpiistudio/memory (global + project). */
  memoryExcerpts?: string
  skills: SkillCatalogEntry[]
  loadedSkills: LoadedSkill[]
  fingerprint: string
}

const AGENT_LIMIT = 32_000
const SKILL_LIMIT = 64_000
const LOADED_SKILL_LIMIT = 20_000
const MAX_SKILLS = 100
const MEMORY_FILE_LIMIT = 8_000
const MEMORY_TOTAL_LIMIT = 24_000
const MAX_MEMORY_FILES = 12

type ParsedSkill = SkillCatalogEntry & { body: string; content: string }

function readCapped(file: string, limit: number): string | undefined {
  try {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > limit) return undefined
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  } catch {
    return undefined
  }
}

function markdownFiles(root: string): string[] {
  const files: string[] = []
  const visit = (dir: string): void => {
    if (files.length >= MAX_SKILLS) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_SKILLS) break
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(full)
    }
  }
  visit(root)
  return files
}

function scalar(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function parseSkill(file: string, source: SkillCatalogEntry['source']): ParsedSkill | undefined {
  const content = readCapped(file, SKILL_LIMIT)
  if (!content) return undefined
  let body = content
  let name = path.basename(file, path.extname(file))
  let description = ''
  // ponytail: frontmatter supports scalar name/description; add a YAML parser only when the schema expands.
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4)
    if (end !== -1) {
      const frontmatter = content.slice(4, end)
      body = content.slice(end + 5).trim()
      for (const line of frontmatter.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
        if (!match) continue
        if (match[1] === 'name' && match[2]) name = scalar(match[2])
        if (match[1] === 'description' && match[2]) description = scalar(match[2])
      }
    }
  }
  if (!description) {
    description = body
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find((line) => line && !line.startsWith('```')) ?? 'No description'
  }
  name = name.trim().slice(0, 100)
  if (!name) return undefined
  return {
    name,
    description: description.slice(0, 240),
    body: body.slice(0, LOADED_SKILL_LIMIT),
    content,
    source,
    path: path.resolve(file),
  }
}

function selectedSkillNames(prompt: string): Set<string> {
  const names = new Set<string>()
  for (const match of prompt.matchAll(/(?:^|\n)\s*\/skill\s+([^\n]+)/gi)) {
    const name = match[1]?.trim().toLowerCase()
    if (name) names.add(name)
  }
  return names
}

function saveContextState(root: string, context: ProjectContext, homeDir: string): void {
  const dir = path.join(homeDir, '.enpiistudio', 'projects', projectHash(root))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'context.json')
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify({
    projectRoot: path.resolve(root),
    fingerprint: context.fingerprint,
    agentInstructions: Boolean(context.projectInstructions),
    hasMemory: Boolean(context.memoryExcerpts),
    skills: context.skills,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}

function memoryDirs(root: string, homeDir: string): { label: 'project' | 'global'; dir: string }[] {
  const hash = projectHash(root)
  return [
    { label: 'project', dir: path.join(homeDir, '.enpiistudio', 'memory', 'projects', hash) },
    { label: 'global', dir: path.join(homeDir, '.enpiistudio', 'memory', 'global') },
  ]
}

function safeMemorySlug(name: string): string {
  const base = name.trim().replace(/\.md$/i, '').toLowerCase()
  const slug = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  if (!slug || slug === '.' || slug === '..') throw new Error('invalid memory name')
  return slug
}

/** Load free-form markdown notes from global + project memory dirs (capped). */
export function loadMemoryExcerpts(root: string, homeDir = os.homedir()): string | undefined {
  const sections: string[] = []
  let remaining = MEMORY_TOTAL_LIMIT
  let count = 0
  for (const { label, dir } of memoryDirs(root, homeDir)) {
    for (const file of markdownFiles(dir)) {
      if (count >= MAX_MEMORY_FILES || remaining <= 0) break
      const body = readCapped(file, Math.min(MEMORY_FILE_LIMIT, remaining))
      if (!body) continue
      const rel = path.basename(file)
      const block = `### ${label}/${rel}\n${body}`
      sections.push(block.slice(0, remaining))
      remaining -= block.length
      count++
    }
  }
  if (!sections.length) return undefined
  return sections.join('\n\n')
}

function memoryFilePath(
  root: string,
  scope: 'project' | 'global',
  slug: string,
  homeDir: string,
): string {
  const dir =
    scope === 'global'
      ? path.join(homeDir, '.enpiistudio', 'memory', 'global')
      : path.join(homeDir, '.enpiistudio', 'memory', 'projects', projectHash(root))
  return path.join(dir, `${slug}.md`)
}

/** Write durable memory note under ~/.enpiistudio/memory. */
export function memoryWrite(
  root: string,
  opts: { name: string; content: string; scope?: 'project' | 'global'; homeDir?: string },
): { ok: boolean; summary: string; content: string } {
  try {
    const homeDir = opts.homeDir ?? os.homedir()
    const scope = opts.scope === 'global' ? 'global' : 'project'
    const slug = safeMemorySlug(opts.name)
    if (opts.content.length > MEMORY_FILE_LIMIT) {
      return { ok: false, summary: `content too large (>${MEMORY_FILE_LIMIT})`, content: `content too large (>${MEMORY_FILE_LIMIT})` }
    }
    const file = memoryFilePath(root, scope, slug, homeDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const existed = fs.existsSync(file)
    fs.writeFileSync(file, opts.content.replace(/\r\n/g, '\n'), 'utf8')
    const summary = `memory_write ${scope}/${slug}.md (${existed ? 'overwrite' : 'create'}, ${opts.content.length} chars)`
    return { ok: true, summary, content: summary }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: msg, content: msg }
  }
}

/** Delete durable memory note. */
export function memoryDelete(
  root: string,
  opts: { name: string; scope?: 'project' | 'global'; homeDir?: string },
): { ok: boolean; summary: string; content: string } {
  try {
    const homeDir = opts.homeDir ?? os.homedir()
    const scope = opts.scope === 'global' ? 'global' : 'project'
    const slug = safeMemorySlug(opts.name)
    const file = memoryFilePath(root, scope, slug, homeDir)
    if (!fs.existsSync(file)) {
      return { ok: false, summary: `memory not found: ${scope}/${slug}.md`, content: `memory not found: ${scope}/${slug}.md` }
    }
    fs.rmSync(file, { force: true })
    const summary = `memory_delete ${scope}/${slug}.md`
    return { ok: true, summary, content: summary }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: msg, content: msg }
  }
}

/** Search durable memory notes (ranked: match strength + recency). */
export function memorySearch(
  root: string,
  opts: { query: string; regex?: boolean; maxResults?: number; homeDir?: string },
): { ok: boolean; summary: string; content: string } {
  try {
    const q = opts.query.trim()
    if (!q) return { ok: false, summary: 'query required', content: 'query required' }
    const homeDir = opts.homeDir ?? os.homedir()
    const max = Math.min(Math.max(opts.maxResults ?? 20, 1), 100)
    let re: RegExp
    try {
      re = opts.regex
        ? new RegExp(q, 'i')
        : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: `bad regex: ${msg}`, content: `bad regex: ${msg}` }
    }
    const now = Date.now()
    const ranked: { score: number; line: string }[] = []
    for (const { label, dir } of memoryDirs(root, homeDir)) {
      for (const file of markdownFiles(dir)) {
        const body = readCapped(file, MEMORY_FILE_LIMIT)
        if (!body) continue
        const rel = `${label}/${path.basename(file)}`
        const nameHit = re.test(rel)
        const bodyHit = re.test(body)
        if (!nameHit && !bodyHit) continue
        let mtime = 0
        try {
          mtime = fs.statSync(file).mtimeMs
        } catch {
          /* ignore */
        }
        const matchLine = body.split(/\r?\n/).find((l) => re.test(l)) ?? body.slice(0, 120)
        // Score: name match > body; recency boost over ~30d half-life.
        const ageDays = Math.max(0, (now - mtime) / 86_400_000)
        const recency = Math.exp(-ageDays / 30)
        const strength = (nameHit ? 3 : 0) + (bodyHit ? 1 : 0) + (matchLine.toLowerCase().includes(q.toLowerCase()) ? 1 : 0)
        const score = strength * 10 + recency * 5
        ranked.push({
          score,
          line: `${rel}: ${matchLine.trim().slice(0, 200)}`,
        })
      }
    }
    ranked.sort((a, b) => b.score - a.score)
    const hits = ranked.slice(0, max).map((h) => h.line)
    return {
      ok: true,
      summary: `memory_search ${hits.length} hit(s)`,
      content: hits.join('\n') || '(no matches)',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: msg, content: msg }
  }
}

const AGENT_STUB =
  '# Project agent instructions\n\nAdd durable project guidance for enpii here.\n'
const SNAPSHOT_LIMIT = 4_000

function isAgentStub(text: string | undefined): boolean {
  if (!text) return true
  const t = text.trim()
  if (!t) return true
  if (t === AGENT_STUB.trim()) return true
  // Only the default one-liner placeholder counts as stub.
  return /^#\s*Project agent instructions\s+Add durable project guidance for enpii here\.?\s*$/i.test(
    t.replace(/\s+/g, ' ').trim(),
  )
}

function readJsonSafe(file: string): Record<string, unknown> | undefined {
  try {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 200_000) return undefined
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw) as unknown
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function topLevelEntries(root: string, max = 24): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, max)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
  } catch {
    return []
  }
}

function detectStack(pkg: Record<string, unknown> | undefined, entries: string[]): string[] {
  const deps = {
    ...(typeof pkg?.dependencies === 'object' && pkg.dependencies ? pkg.dependencies as Record<string, unknown> : {}),
    ...(typeof pkg?.devDependencies === 'object' && pkg.devDependencies
      ? pkg.devDependencies as Record<string, unknown>
      : {}),
  }
  const hits: string[] = []
  const has = (name: string) => name in deps
  if (has('typescript') || entries.some((e) => e.endsWith('tsconfig.json'))) hits.push('TypeScript')
  if (has('svelte') || has('@sveltejs/vite-plugin-svelte')) hits.push('Svelte')
  if (has('electron')) hits.push('Electron')
  if (has('react') || has('react-dom')) hits.push('React')
  if (has('vue')) hits.push('Vue')
  if (has('next')) hits.push('Next.js')
  if (has('vite')) hits.push('Vite')
  if (has('express') || has('fastify') || has('hono')) hits.push('Node server')
  if (has('python') || entries.includes('pyproject.toml') || entries.includes('requirements.txt')) hits.push('Python')
  if (entries.includes('Cargo.toml')) hits.push('Rust')
  if (entries.includes('go.mod')) hits.push('Go')
  return hits.slice(0, 8)
}

function gitBrief(root: string): string[] {
  const lines: string[] = []
  try {
    const head = path.join(root, '.git', 'HEAD')
    if (!fs.existsSync(head)) return lines
    const raw = fs.readFileSync(head, 'utf8').trim()
    const branch = raw.startsWith('ref:')
      ? raw.replace(/^ref:\s*refs\/heads\//, '').trim()
      : raw.slice(0, 8)
    if (branch) lines.push(`branch: ${branch}`)
  } catch {
    /* ignore */
  }
  return lines
}

/** Compact workspace map for chat-default (no LLM). */
export function buildProjectSnapshot(root: string): string {
  const rootAbs = path.resolve(root)
  const entries = topLevelEntries(rootAbs)
  const pkg = readJsonSafe(path.join(rootAbs, 'package.json'))
  const scripts =
    pkg && typeof pkg.scripts === 'object' && pkg.scripts
      ? Object.entries(pkg.scripts as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .slice(0, 12)
        .map(([k, v]) => `- ${k}: ${String(v).slice(0, 80)}`)
      : []
  const stack = detectStack(pkg, entries)
  const git = gitBrief(rootAbs)
  const name = typeof pkg?.name === 'string' ? pkg.name : path.basename(rootAbs)
  const parts = [
    `Project: ${name}`,
    entries.length ? `Top-level:\n${entries.map((e) => `- ${e}`).join('\n')}` : '',
    stack.length ? `Stack signals: ${stack.join(', ')}` : '',
    scripts.length ? `npm scripts:\n${scripts.join('\n')}` : '',
    git.length ? `Git: ${git.join('; ')}` : '',
    'Prefer search_codebase / grep / glob before broad reads. Keep diffs small.',
  ].filter(Boolean)
  return parts.join('\n\n').slice(0, SNAPSHOT_LIMIT)
}

function renderAgentBrief(snapshot: string): string {
  return [
    '# Project agent instructions',
    '',
    '_Auto-generated starter brief. Edit freely — enpii will not overwrite once you change this file._',
    '',
    snapshot,
    '',
  ].join('\n')
}

/**
 * Fill `.enpii/AGENT.md` once from a filesystem snapshot when still the default stub.
 * Never overwrites user-edited instructions.
 */
export function ensureProjectBrief(root: string): { wrote: boolean; snapshot: string } {
  const rootAbs = path.resolve(root)
  const snapshot = buildProjectSnapshot(rootAbs)
  const agent = path.join(rootAbs, '.enpii', 'AGENT.md')
  let existing: string | undefined
  try {
    if (fs.existsSync(agent)) existing = fs.readFileSync(agent, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
  } catch {
    existing = undefined
  }
  if (!isAgentStub(existing)) return { wrote: false, snapshot }
  try {
    fs.mkdirSync(path.dirname(agent), { recursive: true })
    fs.writeFileSync(agent, renderAgentBrief(snapshot), 'utf8')
    return { wrote: true, snapshot }
  } catch {
    return { wrote: false, snapshot }
  }
}

/** Create `.enpii/` scaffold on first use (AGENT.md + skills/ + config.toml + mcp.json). */
export function ensureEnpiiDir(root: string): { created: boolean; path: string } {
  const dir = path.join(path.resolve(root), '.enpii')
  const agent = path.join(dir, 'AGENT.md')
  const skills = path.join(dir, 'skills')
  const configToml = path.join(dir, 'config.toml')
  const mcpJson = path.join(dir, 'mcp.json')
  let created = false
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    created = true
  }
  if (!fs.existsSync(skills)) {
    fs.mkdirSync(skills, { recursive: true })
    created = true
  }
  if (!fs.existsSync(agent)) {
    fs.writeFileSync(agent, AGENT_STUB, 'utf8')
    created = true
  }
  if (!fs.existsSync(configToml)) {
    // No secrets — project overlay only (model/dialect/denyGlobs optional).
    fs.writeFileSync(
      configToml,
      '# Project enpii config (optional overrides; no API keys)\n# model = "enpii"\n# dialect = "openai"\n# permissionMode = "ask"\n# denyGlobs = [".env", "**/*secret*"]\n',
      'utf8',
    )
    created = true
  }
  if (!fs.existsSync(mcpJson)) {
    fs.writeFileSync(
      mcpJson,
      `${JSON.stringify({ servers: {}, _comment: 'Project MCP servers (stdio). Merge with ~/.enpiistudio/mcp.json' }, null, 2)}\n`,
      'utf8',
    )
    created = true
  }
  // Chat-default: replace stub with real brief once.
  if (ensureProjectBrief(root).wrote) created = true
  return { created, path: dir }
}

export function discoverProjectContext(root: string, prompt = '', options?: {
  homeDir?: string
  persist?: boolean
  loadMemory?: boolean
}): ProjectContext {
  const homeDir = options?.homeDir ?? os.homedir()
  // Best-effort brief before read so first chat sees real instructions.
  try {
    ensureProjectBrief(root)
  } catch {
    /* read-only trees still run */
  }
  const projectInstructions = readCapped(path.join(root, '.enpii', 'AGENT.md'), AGENT_LIMIT)
  const projectSnapshot = buildProjectSnapshot(root)
  const memoryExcerpts = options?.loadMemory === false ? undefined : loadMemoryExcerpts(root, homeDir)
  const merged = new Map<string, ParsedSkill>()
  for (const [skillsRoot, source] of [
    [path.join(homeDir, '.enpiistudio', 'skills'), 'global'],
    [path.join(root, '.enpii', 'skills'), 'project'],
  ] as const) {
    for (const file of markdownFiles(skillsRoot)) {
      const skill = parseSkill(file, source)
      if (skill) merged.set(skill.name.toLowerCase(), skill)
    }
  }
  const parsed = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SKILLS)
  const selected = selectedSkillNames(prompt)
  const context: ProjectContext = {
    projectInstructions,
    projectSnapshot,
    memoryExcerpts,
    skills: parsed.map(({ body: _body, content: _content, ...skill }) => skill),
    loadedSkills: parsed
      .filter((skill) => selected.has(skill.name.toLowerCase()))
      .map((skill) => ({ name: skill.name, body: skill.body })),
    fingerprint: crypto.createHash('sha256')
      .update(projectInstructions ?? '')
      .update(projectSnapshot)
      .update(memoryExcerpts ?? '')
      .update(parsed.map((skill) => `${skill.source}:${skill.name}:${skill.content}`).join('\n'))
      .digest('hex')
      .slice(0, 16),
  }
  if (options?.persist !== false) {
    try {
      saveContextState(root, context, homeDir)
    } catch {
      // Context remains usable when global state is read-only.
    }
  }
  return context
}

export function projectContextPrompt(context: ProjectContext, runtime: {
  workspaceRoot: string
  permissionMode: string
}): string {
  const sections = [
    `Runtime:\n- workspaceRoot: ${path.resolve(runtime.workspaceRoot)}\n- permissionMode: ${runtime.permissionMode}\n- platform: ${process.platform}\n- date: ${new Date().toISOString()}`,
  ]
  if (context.projectInstructions) sections.push(`Project instructions (.enpii/AGENT.md):\n${context.projectInstructions}`)
  // Snapshot always present for chat-default; skip if AGENT.md already embeds the same auto brief.
  if (context.projectSnapshot) {
    const instructions = context.projectInstructions ?? ''
    if (!instructions.includes(context.projectSnapshot.slice(0, 120))) {
      sections.push(`Project snapshot (auto, capped):\n${context.projectSnapshot}`)
    }
  }
  if (context.memoryExcerpts) sections.push(`Durable memory (~/.enpiistudio/memory, capped):\n${context.memoryExcerpts}`)
  if (context.skills.length) {
    sections.push(`Available skills (use only when relevant; bodies are not loaded unless selected with /skill <name>):\n${context.skills.map((skill) => `- ${skill.name} [${skill.source}]: ${skill.description}`).join('\n')}`)
  }
  for (const skill of context.loadedSkills) sections.push(`Loaded skill: ${skill.name}\n${skill.body}`)
  return sections.join('\n\n')
}
