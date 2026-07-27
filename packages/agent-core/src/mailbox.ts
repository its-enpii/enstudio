/**
 * Durable inter-agent mailbox (ClawTeam-pattern file inbox, own contract).
 * Store: ENPII_HOME/projects/<hash>/mailbox/<agentId>/msg-*.json
 * Atomic write tmp→rename. receive consumes; peek does not.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectHash } from './persist.js'

export type MailMessage = {
  id: string
  from: string
  to: string
  content: string
  type: string
  createdAt: string
  /** Optional free-form meta (task id, etc.) */
  meta?: Record<string, string>
}

const MAX_CONTENT = 8_000
const MAX_AGENT = 64
const MAX_INBOX_FILES = 200

function home(): string {
  return process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
}

function safeAgent(id: string): string | undefined {
  const raw = id.trim()
  if (!raw || /[/\\]|\.\./.test(raw)) return undefined
  const s = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_AGENT)
  if (!s) return undefined
  return s
}

function inboxDir(projectRoot: string, agentId: string): string {
  return path.join(home(), 'projects', projectHash(projectRoot), 'mailbox', agentId)
}

function eventsDir(projectRoot: string): string {
  return path.join(home(), 'projects', projectHash(projectRoot), 'mailbox', '_events')
}

function writeAtomic(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
  fs.writeFileSync(tmp, body, 'utf8')
  fs.renameSync(tmp, file)
}

function logEvent(projectRoot: string, msg: MailMessage): void {
  const dir = eventsDir(projectRoot)
  const file = path.join(dir, `evt-${Date.now()}-${msg.id}.json`)
  writeAtomic(file, `${JSON.stringify(msg, null, 2)}\n`)
  // cap event log
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('evt-')).sort()
    if (files.length > 500) {
      for (const f of files.slice(0, files.length - 500)) {
        try {
          fs.unlinkSync(path.join(dir, f))
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
}

export function mailboxSend(
  projectRoot: string,
  input: {
    from?: string
    to?: string
    content?: string
    message?: string
    type?: string
    meta?: Record<string, string>
  },
): { ok: true; message: MailMessage; content: string } | { ok: false; content: string } {
  const from = safeAgent(String(input.from ?? 'main'))
  const to = safeAgent(String(input.to ?? ''))
  const body = String(input.content ?? input.message ?? '').trim().slice(0, MAX_CONTENT)
  if (!from) return { ok: false, content: 'mailbox_send requires valid from' }
  if (!to) return { ok: false, content: 'mailbox_send requires valid to (agent id or main)' }
  if (!body) return { ok: false, content: 'mailbox_send requires content' }
  const msg: MailMessage = {
    id: crypto.randomBytes(4).toString('hex'),
    from,
    to,
    content: body,
    type: String(input.type ?? 'message').trim().slice(0, 40) || 'message',
    createdAt: new Date().toISOString(),
    meta: input.meta,
  }
  const dir = inboxDir(projectRoot, to)
  const file = path.join(dir, `msg-${Date.now()}-${msg.id}.json`)
  writeAtomic(file, `${JSON.stringify(msg, null, 2)}\n`)
  logEvent(projectRoot, msg)
  // trim oversized inbox
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('msg-') && f.endsWith('.json')).sort()
    if (files.length > MAX_INBOX_FILES) {
      for (const f of files.slice(0, files.length - MAX_INBOX_FILES)) {
        try {
          fs.unlinkSync(path.join(dir, f))
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
  return {
    ok: true,
    message: msg,
    content: `sent ${msg.id} ${from}→${to} (${msg.type}): ${body.slice(0, 120)}`,
  }
}

function readInboxFiles(projectRoot: string, agentId: string): { file: string; msg: MailMessage }[] {
  const id = safeAgent(agentId)
  if (!id) return []
  const dir = inboxDir(projectRoot, id)
  if (!fs.existsSync(dir)) return []
  const out: { file: string; msg: MailMessage }[] = []
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('msg-') && f.endsWith('.json')).sort()
  for (const f of files) {
    const file = path.join(dir, f)
    try {
      const msg = JSON.parse(fs.readFileSync(file, 'utf8')) as MailMessage
      if (msg?.id && msg.content) out.push({ file, msg })
    } catch {
      /* skip corrupt */
    }
  }
  return out
}

export function mailboxPeek(
  projectRoot: string,
  agentId: string,
  limit = 20,
): { ok: true; messages: MailMessage[]; content: string } | { ok: false; content: string } {
  const id = safeAgent(agentId)
  if (!id) return { ok: false, content: 'mailbox_inbox requires agent id (or main)' }
  const cap = Math.max(1, Math.min(50, limit))
  const items = readInboxFiles(projectRoot, id).slice(0, cap)
  const messages = items.map((i) => i.msg)
  return {
    ok: true,
    messages,
    content: messages.length
      ? messages
          .map((m) => `#${m.id} ${m.from}→${m.to} [${m.type}] ${m.createdAt}\n${m.content}`)
          .join('\n---\n')
      : `(empty inbox for ${id})`,
  }
}

export function mailboxReceive(
  projectRoot: string,
  agentId: string,
  limit = 20,
): { ok: true; messages: MailMessage[]; content: string } | { ok: false; content: string } {
  const id = safeAgent(agentId)
  if (!id) return { ok: false, content: 'mailbox_inbox requires agent id (or main)' }
  const cap = Math.max(1, Math.min(50, limit))
  const items = readInboxFiles(projectRoot, id).slice(0, cap)
  const messages: MailMessage[] = []
  for (const item of items) {
    messages.push(item.msg)
    try {
      fs.unlinkSync(item.file)
    } catch {
      /* */
    }
  }
  return {
    ok: true,
    messages,
    content: messages.length
      ? messages
          .map((m) => `#${m.id} ${m.from}→${m.to} [${m.type}] ${m.createdAt}\n${m.content}`)
          .join('\n---\n')
      : `(empty inbox for ${id})`,
  }
}

export function mailboxBroadcast(
  projectRoot: string,
  input: {
    from?: string
    content?: string
    message?: string
    /** Extra recipients beyond main + live-ish known agents list */
    to?: string[]
    agents?: string[]
  },
): { ok: true; sent: number; content: string } | { ok: false; content: string } {
  const body = String(input.content ?? input.message ?? '').trim()
  if (!body) return { ok: false, content: 'mailbox_broadcast requires content' }
  const from = String(input.from ?? 'main')
  const recipients = new Set<string>(['main'])
  for (const a of [...(input.to ?? []), ...(input.agents ?? [])]) {
    const s = safeAgent(a)
    if (s) recipients.add(s)
  }
  // discover existing inbox agent folders
  try {
    const root = path.join(home(), 'projects', projectHash(projectRoot), 'mailbox')
    if (fs.existsSync(root)) {
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (ent.isDirectory() && ent.name !== '_events') {
          const s = safeAgent(ent.name)
          if (s) recipients.add(s)
        }
      }
    }
  } catch {
    /* */
  }
  const lines: string[] = []
  let sent = 0
  for (const to of recipients) {
    if (safeAgent(from) === to) continue
    const r = mailboxSend(projectRoot, { from, to, content: body, type: 'broadcast' })
    if (r.ok) {
      sent++
      lines.push(r.content)
    }
  }
  return {
    ok: true,
    sent,
    content: sent ? `broadcast to ${sent}\n${lines.join('\n')}` : 'broadcast: no recipients',
  }
}
