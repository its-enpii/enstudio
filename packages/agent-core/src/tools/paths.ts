import fs from 'node:fs'
import path from 'node:path'

/** Resolve path under workspace root; throws if escape. */
export function resolveInRoot(root: string, relOrAbs: string): string {
  const rootAbs = path.resolve(root)
  const target = path.resolve(rootAbs, relOrAbs)
  const rel = path.relative(rootAbs, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path outside workspace: ${relOrAbs}`)
  }
  return target
}

export function toRel(root: string, abs: string): string {
  return path.relative(path.resolve(root), abs).split(path.sep).join('/')
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'out',
  'release',
  'coverage',
  '.vite',
  '.next',
  '.turbo',
])

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name === '.enpii'
}
