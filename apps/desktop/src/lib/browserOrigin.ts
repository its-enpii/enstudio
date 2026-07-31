/**
 * Classify browser tab URL: project preview vs public web.
 * No DOM/content sniffing — host/path only.
 *
 * Policy: with an open project, any loopback/private HTTP(S) host is
 * project preview (no port allowlist). Pin origins for non-local staging.
 * file:// under project root → project.
 */

export type PageOrigin = 'project' | 'local' | 'file' | 'public' | 'empty'

/** @deprecated Ports no longer gate classification; kept for older callers. */
export const DEFAULT_PREVIEW_PORTS: number[] = []

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}

function isPrivateIp(host: string): boolean {
  const h = host.toLowerCase()
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

function fileUnderRoot(fileUrl: string, projectRoot?: string): boolean {
  if (!projectRoot?.trim()) return false
  try {
    const u = new URL(fileUrl)
    if (u.protocol !== 'file:') return false
    let p = decodeURIComponent(u.pathname)
    // Windows file:///F:/... → /F:/... → F:/...
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
    const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const norm = p.replace(/\\/g, '/').toLowerCase()
    return norm === root || norm.startsWith(`${root}/`)
  } catch {
    return false
  }
}

export function classifyBrowserUrl(
  rawUrl: string | undefined | null,
  opts?: {
    projectRoot?: string
    /** ignored */
    previewPorts?: number[]
    /** Exact origins pinned as project (staging, tunnel, …). */
    pinnedOrigins?: string[]
  },
): PageOrigin {
  const raw = (rawUrl ?? '').trim()
  if (!raw || raw === 'about:blank') return 'empty'

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'public'
  }

  if (u.protocol === 'file:') {
    return fileUnderRoot(raw, opts?.projectRoot) ? 'project' : 'file'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'public'

  const origin = u.origin.toLowerCase()
  for (const pin of opts?.pinnedOrigins ?? []) {
    try {
      if (new URL(pin).origin.toLowerCase() === origin) return 'project'
    } catch {
      /* skip */
    }
  }

  const host = u.hostname
  const local = isLoopbackHost(host) || isPrivateIp(host)
  if (local) {
    return opts?.projectRoot?.trim() ? 'project' : 'local'
  }
  return 'public'
}

export function pageOriginLabel(o: PageOrigin): string {
  switch (o) {
    case 'project':
      return 'Project'
    case 'local':
      return 'Local'
    case 'file':
      return 'File'
    case 'public':
      return 'Public'
    default:
      return ''
  }
}

export function pageOriginHint(o: PageOrigin): string {
  switch (o) {
    case 'project':
      return 'Local/private host with a project open — Outline + Edit with AI enabled'
    case 'local':
      return 'Loopback/private host with no project open'
    case 'file':
      return 'Local file outside the project root'
    case 'public':
      return 'Public web — no DOM inject or structural edit'
    default:
      return 'No page loaded'
  }
}

/**
 * Address bar / navigate: bare hosts get a scheme.
 * Loopback + private → http (dev servers); else https.
 */
export function suggestNavigateUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return raw
  const hostPart = raw.split('/')[0] ?? raw
  const hostOnly = hostPart.split(':')[0] ?? hostPart
  if (isLoopbackHost(hostOnly) || isPrivateIp(hostOnly) || hostOnly === '0.0.0.0') {
    return `http://${raw}`
  }
  return `https://${raw}`
}
