import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { resolveInRoot } from './tools/paths.js'

const DIR = 'enpiistudio-checkpoints'

export interface CheckpointFile {
  path: string
  existed: boolean
  size: number
}

export interface Checkpoint {
  id: string
  createdAt: string
  prompt?: string
  files: CheckpointFile[]
}

function checkpointRoot(root: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('invalid checkpoint id')
  const projectId = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 24)
  return path.join(os.tmpdir(), DIR, projectId, id)
}

function checkpointStore(root: string): string {
  return path.dirname(checkpointRoot(root, 'checkpoint-root'))
}

function metadataPath(root: string, id: string): string {
  return path.join(checkpointRoot(root, id), 'checkpoint.json')
}

function readCheckpoint(root: string, id: string): Checkpoint {
  const file = metadataPath(root, id)
  if (!fs.existsSync(file)) throw new Error('checkpoint not found')
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Checkpoint
}

export function checkpointSnapshot(root: string, id: string, relPath: string, prompt?: string): Checkpoint {
  const target = resolveInRoot(root, relPath)
  if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error(`cannot checkpoint file: ${relPath}`)
  let checkpoint: Checkpoint
  const dir = checkpointRoot(root, id)
  if (fs.existsSync(dir)) checkpoint = readCheckpoint(root, id)
  else {
    fs.mkdirSync(dir, { recursive: true })
    checkpoint = { id, createdAt: new Date().toISOString(), prompt: prompt?.trim() || undefined, files: [] }
  }
  if (checkpoint.files.some((file) => file.path === relPath)) return checkpoint
  const backup = path.join(checkpointRoot(root, id), 'files', relPath)
  const existed = fs.existsSync(target)
  if (existed) {
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.copyFileSync(target, backup)
  }
  checkpoint.files.push({ path: relPath, existed, size: existed ? fs.statSync(target).size : 0 })
  fs.writeFileSync(metadataPath(root, id), JSON.stringify(checkpoint, null, 2))
  return checkpoint
}

export function checkpointList(root: string, limit = 20): Checkpoint[] {
  const dir = checkpointStore(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try { return readCheckpoint(root, entry.name) } catch { return null }
    })
    .filter((item): item is Checkpoint => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.min(Math.max(limit, 1), 100))
}

export function checkpointRollback(root: string, id: string, relPath?: string): Checkpoint {
  const checkpoint = readCheckpoint(root, id)
  const files = relPath ? checkpoint.files.filter((file) => file.path === relPath) : checkpoint.files
  if (relPath && files.length === 0) throw new Error('file is not part of checkpoint')
  for (const file of files) {
    const target = resolveInRoot(root, file.path)
    const backup = path.join(checkpointRoot(root, id), 'files', file.path)
    if (file.existed) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(backup, target)
    } else if (fs.existsSync(target)) fs.rmSync(target, { force: true })
  }
  return checkpoint
}

export function checkpointAccept(root: string, id: string, relPath?: string): Checkpoint[] {
  const checkpoint = readCheckpoint(root, id)
  if (!relPath) {
    fs.rmSync(checkpointRoot(root, id), { recursive: true, force: true })
    return checkpointList(root)
  }
  if (!checkpoint.files.some((file) => file.path === relPath)) throw new Error('file is not part of checkpoint')
  const backup = path.join(checkpointRoot(root, id), 'files', relPath)
  fs.rmSync(backup, { force: true })
  checkpoint.files = checkpoint.files.filter((file) => file.path !== relPath)
  if (checkpoint.files.length === 0) fs.rmSync(checkpointRoot(root, id), { recursive: true, force: true })
  else fs.writeFileSync(metadataPath(root, id), JSON.stringify(checkpoint, null, 2))
  return checkpointList(root)
}

export function newCheckpointId(): string {
  return `turn-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`
}

export function checkpointClearAll(): void {
  fs.rmSync(path.join(os.tmpdir(), DIR), { recursive: true, force: true })
}
