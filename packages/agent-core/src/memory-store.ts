/**
 * Namespace+key JSON store under ~/.enpiistudio/memory/store/.
 * Coexists with freeform markdown memory notes.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectHash } from './persist.js'

const KEY_LIMIT = 64
const NS_SEG_LIMIT = 48
const MAX_NS_DEPTH = 6
const VALUE_LIMIT = 64_000
const SEARCH_CAP = 100

export type StoreScope = 'project' | 'global'

function home(homeDir?: string): string {
  return homeDir?.trim() || process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function safeSeg(raw: string, max: number): string | undefined {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max)
  if (!s || s === '.' || s === '..') return undefined
  return s
}

function normalizeNs(namespace: string[]): string[] | { error: string } {
  if (!Array.isArray(namespace) || !namespace.length) return { error: 'namespace required (non-empty array)' }
  if (namespace.length > MAX_NS_DEPTH) return { error: `namespace max depth ${MAX_NS_DEPTH}` }
  const out: string[] = []
  for (const seg of namespace) {
    if (typeof seg !== 'string') return { error: 'namespace segments must be strings' }
    const s = safeSeg(seg, NS_SEG_LIMIT)
    if (!s) return { error: `bad namespace segment: ${seg}` }
    out.push(s)
  }
  return out
}

function normalizeKey(key: string): string | { error: string } {
  const s = safeSeg(key, KEY_LIMIT)
  if (!s) return { error: 'bad key' }
  return s
}

function storeRoot(root: string, scope: StoreScope, homeDir?: string): string {
  const base = path.join(home(homeDir), 'memory', 'store')
  return scope === 'global'
    ? path.join(base, 'global')
    : path.join(base, 'projects', projectHash(root))
}

function entryPath(root: string, scope: StoreScope, ns: string[], key: string, homeDir?: string): string {
  return path.join(storeRoot(root, scope, homeDir), ...ns, `${key}.json`)
}

export function storePut(
  root: string,
  opts: {
    namespace: string[]
    key: string
    value: unknown
    scope?: StoreScope
    homeDir?: string
  },
): { ok: boolean; summary: string; content: string } {
  try {
    const ns = normalizeNs(opts.namespace)
    if ('error' in ns) return { ok: false, summary: ns.error, content: ns.error }
    const key = normalizeKey(opts.key)
    if (typeof key !== 'string') return { ok: false, summary: key.error, content: key.error }
    const scope: StoreScope = opts.scope === 'global' ? 'global' : 'project'
    const body = JSON.stringify(
      { value: opts.value, updatedAt: new Date().toISOString() },
      null,
      2,
    )
    if (body.length > VALUE_LIMIT) {
      return { ok: false, summary: `value too large (>${VALUE_LIMIT})`, content: `value too large (>${VALUE_LIMIT})` }
    }
    const file = entryPath(root, scope, ns, key, opts.homeDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const existed = fs.existsSync(file)
    fs.writeFileSync(file, body, 'utf8')
    const rel = `${scope}/${ns.join('/')}/${key}`
    const summary = `memory_store put ${rel} (${existed ? 'overwrite' : 'create'})`
    return { ok: true, summary, content: summary }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: msg, content: msg }
  }
}

export function storeGet(
  root: string,
  opts: { namespace: string[]; key: string; scope?: StoreScope; homeDir?: string },
): { ok: boolean; summary: string; content: string } {
  try {
    const ns = normalizeNs(opts.namespace)
    if ('error' in ns) return { ok: false, summary: ns.error, content: ns.error }
    const key = normalizeKey(opts.key)
    if (typeof key !== 'string') return { ok: false, summary: key.error, content: key.error }
    const scope: StoreScope = opts.scope === 'global' ? 'global' : 'project'
    const file = entryPath(root, scope, ns, key, opts.homeDir)
    if (!fs.existsSync(file)) {
      const miss = `memory_store miss ${scope}/${ns.join('/')}/${key}`
      return { ok: false, summary: miss, content: miss }
    }
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as { value?: unknown; updatedAt?: string }
    const content = JSON.stringify(
      { namespace: ns, key, scope, value: parsed.value, updatedAt: parsed.updatedAt },
      null,
      2,
    )
    return { ok: true, summary: `memory_store get ${scope}/${ns.join('/')}/${key}`, content }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: msg, content: msg }
  }
}

export function storeDelete(
  root: string,
  opts: { namespace: string[]; key: string; scope?: StoreScope; homeDir?: string },
): { ok: boolean; summary: string; content: string } {
  try {
    const ns = normalizeNs(opts.namespace)
    if ('error' in ns) return { ok: false, summary: ns.error, content: ns.error }
    const key = normalizeKey(opts.key)
    if (typeof key !== 'string') return { ok: false, summary: key.error, content: key.error }
    const scope: StoreScope = opts.scope === 'global' ? 'global' : 'project'
    const file = entryPath(root, scope, ns, key, opts.homeDir)
    if (!fs.existsSync(file)) {
      const miss = `memory_store not found ${scope}/${ns.join('/')}/${key}`
      return { ok: false, summary: miss, content: miss }
    }
    fs.rmSync(file, { force: true })
    const summary = `memory_store delete ${scope}/${ns.join('/')}/${key}`
    return { ok: true, summary, content: summary }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: msg, content: msg }
  }
}

function walkJson(dir: string, base: string, acc: string[]): void {
  if (acc.length >= SEARCH_CAP) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (acc.length >= SEARCH_CAP) break
    if (e.isSymbolicLink()) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkJson(full, base, acc)
    else if (e.isFile() && e.name.endsWith('.json')) acc.push(full)
  }
}

export function storeSearch(
  root: string,
  opts: {
    namespace?: string[]
    query?: string
    scope?: StoreScope | 'all'
    homeDir?: string
    maxResults?: number
  },
): { ok: boolean; summary: string; content: string } {
  try {
    const homeDir = opts.homeDir
    const max = Math.min(Math.max(opts.maxResults ?? 20, 1), SEARCH_CAP)
    const q = (opts.query ?? '').trim().toLowerCase()
    const scopes: StoreScope[] =
      opts.scope === 'global' ? ['global'] : opts.scope === 'project' ? ['project'] : ['project', 'global']
    let nsFilter: string[] | undefined
    if (opts.namespace?.length) {
      const ns = normalizeNs(opts.namespace)
      if ('error' in ns) return { ok: false, summary: ns.error, content: ns.error }
      nsFilter = ns
    }
    const hits: string[] = []
    for (const scope of scopes) {
      const rootDir = nsFilter
        ? path.join(storeRoot(root, scope, homeDir), ...nsFilter)
        : storeRoot(root, scope, homeDir)
      const files: string[] = []
      walkJson(rootDir, rootDir, files)
      for (const file of files) {
        if (hits.length >= max) break
        let raw: string
        try {
          raw = fs.readFileSync(file, 'utf8')
        } catch {
          continue
        }
        if (q && !raw.toLowerCase().includes(q) && !file.toLowerCase().includes(q)) continue
        const rel = path.relative(storeRoot(root, scope, homeDir), file).split(path.sep).join('/')
        hits.push(`${scope}/${rel.replace(/\.json$/, '')}`)
      }
    }
    if (!hits.length) return { ok: true, summary: 'memory_store search (0)', content: '(no matches)' }
    const content = hits.map((h) => `- ${h}`).join('\n')
    return { ok: true, summary: `memory_store search (${hits.length})`, content }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: msg, content: msg }
  }
}
