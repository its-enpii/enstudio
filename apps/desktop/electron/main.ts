import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  Notification,
  session,
  shell,
  type DownloadItem,
  type Session,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as pty from 'node-pty'
import os from 'node:os'
import { EnpiiClient } from './enpiiClient'
import { listPathBins, pathComplete } from './pathBins'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
const enpii = new EnpiiClient()
const terminals = new Map<string, pty.IPty>()
type DownloadStatus = 'progressing' | 'completed' | 'cancelled' | 'interrupted'
type DownloadSummary = {
  id: string
  filename: string
  url: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  status: DownloadStatus
  startedAt: number
}
const downloadItems = new Map<string, DownloadItem>()
const downloads = new Map<string, DownloadSummary>()
const downloadSessions = new WeakSet<Session>()
let rendererMode = 'agent'

/**
 * node-pty on Windows needs a real .exe path — bare `ssh` / `claude` → "File not found:".
 * Resolve via known dirs + where.exe; leave absolute/relative paths alone.
 */
function resolveSpawnCommand(command: string): string {
  const raw = command.trim()
  if (!raw) return raw
  if (process.platform !== 'win32') return raw
  if (path.isAbsolute(raw) || raw.includes('/') || raw.includes('\\') || raw.includes(':')) {
    return raw
  }
  const bare = raw.replace(/\.(exe|cmd|bat)$/i, '')
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const known = [
    path.join(systemRoot, 'System32', 'OpenSSH', `${bare}.exe`),
    path.join(systemRoot, 'System32', `${bare}.exe`),
    path.join(systemRoot, 'SysWOW64', `${bare}.exe`),
  ]
  for (const candidate of known) {
    if (fs.existsSync(candidate)) return candidate
  }
  try {
    const out = execFileSync('where.exe', [raw], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && fs.existsSync(line))
    if (out) return out
  } catch {
    /* not on PATH */
  }
  // Last resort: append .exe so ConPTY search is less ambiguous
  return raw.toLowerCase().endsWith('.exe') ? raw : `${raw}.exe`
}

function cleanEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

/** Minimal Settings read (json + simple toml keys). Priority matches agent-core. */
function readProviderLite(cwd: string): { baseUrl?: string; apiKey?: string; model?: string } {
  const fromJson = (file: string) => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
      return {
        baseUrl:
          typeof data.baseUrl === 'string'
            ? data.baseUrl
            : typeof data.base_url === 'string'
              ? data.base_url
              : undefined,
        apiKey:
          typeof data.apiKey === 'string'
            ? data.apiKey
            : typeof data.api_key === 'string'
              ? data.api_key
              : undefined,
        model: typeof data.model === 'string' ? data.model : undefined,
      }
    } catch {
      return {} as { baseUrl?: string; apiKey?: string; model?: string }
    }
  }
  const fromToml = (file: string) => {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const get = (keys: string[]) => {
        for (const key of keys) {
          const m = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))
          if (m?.[1] !== undefined) return m[1]
        }
        return undefined
      }
      return {
        baseUrl: get(['baseUrl', 'base_url']),
        apiKey: get(['apiKey', 'api_key']),
        model: get(['model']),
      }
    } catch {
      return {} as { baseUrl?: string; apiKey?: string; model?: string }
    }
  }
  const home = process.env.ENPII_HOME?.trim() || path.join(os.homedir(), '.enpiistudio')
  // later wins
  const layers = [
    fromJson(path.join(home, 'config.json')),
    fromToml(path.join(home, 'config.toml')),
    fromToml(path.join(cwd, '.enpii', 'config.toml')),
  ]
  const merged = layers.reduce<{ baseUrl?: string; apiKey?: string; model?: string }>(
    (acc, cur) => ({
      baseUrl: cur.baseUrl ?? acc.baseUrl,
      apiKey: cur.apiKey ?? acc.apiKey,
      model: cur.model ?? acc.model,
    }),
    {},
  )
  return {
    baseUrl: process.env.ENPII_BASE_URL || merged.baseUrl,
    apiKey: process.env.ENPII_API_KEY || merged.apiKey,
    model: process.env.ENPII_MODEL || merged.model,
  }
}

type VendorProviderOverride = { baseUrl?: string; apiKey?: string; model?: string }

/** Env + argv flags so vendor CLIs follow enpii Settings (base URL / model / key). */
function vendorProviderInject(
  command: string,
  cwd: string,
  args: string[],
  override?: VendorProviderOverride,
): { env: Record<string, string>; args: string[] } {
  const file = readProviderLite(cwd)
  const cfg = {
    baseUrl: override?.baseUrl?.trim() || file.baseUrl,
    apiKey: override?.apiKey?.trim() || file.apiKey,
    model: override?.model?.trim() || file.model,
  }
  const env: Record<string, string> = {}
  if (cfg.baseUrl) {
    env.OPENAI_BASE_URL = cfg.baseUrl
    env.OPENAI_API_BASE = cfg.baseUrl
    env.ANTHROPIC_BASE_URL = cfg.baseUrl
    env.ENPII_BASE_URL = cfg.baseUrl
  }
  if (cfg.apiKey) {
    env.OPENAI_API_KEY = cfg.apiKey
    env.ANTHROPIC_API_KEY = cfg.apiKey
    env.GOOGLE_API_KEY = cfg.apiKey
    env.GEMINI_API_KEY = cfg.apiKey
    env.ENPII_API_KEY = cfg.apiKey
  }
  if (cfg.model) {
    env.OPENAI_MODEL = cfg.model
    env.ANTHROPIC_MODEL = cfg.model
    env.ENPII_MODEL = cfg.model
  }
  const bin = path.basename(command).replace(/\.(cmd|exe)$/i, '')
  const nextArgs = [...args]
  const hasModelFlag = nextArgs.some((a) => a === '--model' || a === '-m' || a.startsWith('--model='))
  if (cfg.model && !hasModelFlag) {
    if (bin === 'claude' || bin === 'codex' || bin === 'opencode' || bin === 'gemini' || bin === 'aider') {
      nextArgs.push('--model', cfg.model)
    }
  }
  return { env, args: nextArgs }
}

function killTerminals(): void {
  for (const terminal of terminals.values()) {
    try {
      terminal.kill()
    } catch {
      /* already exited */
    }
  }
  terminals.clear()
}

/** Standard Edit roles so Ctrl/Cmd+C/V/X/A work outside inputs (Windows Electron needs this). */
function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  // Windows/Linux: no in-window menu bar (Edit/View/Window). Mac keeps system menu.
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  // Prefer more-rounded app-icon (taskbar); logo.png corners too subtle at 16–32px.
  const iconCandidates = [
    path.join(__dirname, '../src/lib/image/app-icon.ico'),
    path.join(__dirname, '../src/lib/image/app-icon.png'),
    path.join(__dirname, '../src/lib/image/logo.png'),
    path.join(__dirname, '../dist/app-icon.ico'),
    path.join(__dirname, '../dist/app-icon.png'),
  ]
  const iconPath = iconCandidates.find((p) => fs.existsSync(p))

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#040303',
    title: 'enpiistudio',
    // Custom titlebar in App.svelte (traffic lights = real window controls).
    frame: false,
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // open DevTools only when explicitly requested
    if (process.env.ENPII_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Do not steal Ctrl/Cmd+C/V/X/A — Edit menu roles handle copy of selected chat text.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const modifier = input.control || input.meta
    // Leave clipboard shortcuts alone (selection copy in chat / inspector).
    if (modifier && !input.alt && (key === 'c' || key === 'v' || key === 'x' || key === 'a' || key === 'z' || key === 'y')) {
      return
    }
    const shortcut = modifier && !input.alt
      ? key === 'w'
        ? 'close-tab'
        : key === 't'
          ? 'new-tab'
          : key === 'tab'
            ? input.shift ? 'previous-tab' : 'next-tab'
            : key === 'l'
              ? 'focus-address'
            : key === 'r'
                ? 'reload'
                : key === 'f'
                  ? 'find-page'
                : undefined
      : input.alt && !modifier && key === 'arrowleft'
        ? 'back'
        : input.alt && !modifier && key === 'arrowright'
          ? 'forward'
          : undefined
    const handled = rendererMode === 'browser' || (rendererMode === 'code' && shortcut === 'close-tab')
    if (!shortcut || !handled) return
    event.preventDefault()
    mainWindow?.webContents.send('browser:shortcut', shortcut)
  })

  mainWindow.webContents.on('context-menu', (_evt, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.selectionText?.trim()) {
      items.push({ role: 'copy' })
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      )
    } else if (params.selectionText?.trim()) {
      items.push({ type: 'separator' }, { role: 'selectAll' })
    }
    if (!items.length) return
    Menu.buildFromTemplate(items).popup({ window: mainWindow ?? undefined })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function broadcast(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

type ParsedAttachment = {
  name: string
  path?: string
  size: number
  kind: 'text' | 'image'
  content: string
  images?: { name: string; mime: string; dataUrl: string }[]
  error?: string
}

function imageData(filePath: string, name = path.basename(filePath)): { name: string; mime: string; dataUrl: string } {
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return { name, mime, dataUrl: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` }
}

function parseAttachment(filePath: string): ParsedAttachment {
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error('Attachment bukan file')
  if (stat.size > 10 * 1024 * 1024) throw new Error('Attachment maksimal 10 MB')
  const name = path.basename(filePath)
  const ext = path.extname(name).toLowerCase()
  if (['.pdf', '.docx', '.xlsx', '.doc', '.xls', '.pptx', '.ppt'].includes(ext)) {
    throw new Error(`${ext.slice(1).toUpperCase()} tidak didukung. Gunakan text/code atau gambar.`)
  }
  const textExts = new Set([
    '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml',
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
    '.css', '.scss', '.less', '.html', '.htm', '.php', '.py', '.rb', '.go', '.rs',
    '.csv', '.xml', '.sql', '.sh', '.bash', '.zsh', '.env', '.ini', '.cfg', '.conf',
    '.gitignore', '.dockerignore', '.editorconfig',
  ])
  // Config-like / extensionless text: treat small UTF-8 files as text.
  const looksText =
    textExts.has(ext) ||
    /\.(config|rc|lock)$/i.test(name) ||
    (!ext && stat.size <= 256 * 1024)
  if (looksText) {
    const buf = fs.readFileSync(filePath)
    if (buf.includes(0)) throw new Error(`Format belum didukung: binary ${ext || 'tanpa ekstensi'}`)
    return { name, path: filePath, size: stat.size, kind: 'text', content: buf.toString('utf8') }
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    return {
      name,
      path: filePath,
      size: stat.size,
      kind: 'image',
      content: '[Image attached for vision analysis.]',
      images: [imageData(filePath)],
    }
  }
  throw new Error(`Format belum didukung: ${ext || 'tanpa ekstensi'}`)
}

function parseAttachmentPaths(filePaths: unknown): ParsedAttachment[] {
  if (!Array.isArray(filePaths)) throw new Error('Daftar attachment tidak valid')
  return filePaths.slice(0, 8).map((value) => {
    const filePath = typeof value === 'string' ? value : ''
    const name = filePath ? path.basename(filePath) : 'unknown'
    try {
      if (!path.isAbsolute(filePath)) throw new Error('Path attachment tidak valid')
      return parseAttachment(filePath)
    } catch (err) {
      return {
        name,
        path: filePath || undefined,
        size: 0,
        kind: 'text' as const,
        content: '',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}

function availableDownloadPath(filename: string): string {
  const directory = app.getPath('downloads')
  const safeName = path.basename(filename) || 'download'
  const parsed = path.parse(safeName)
  let candidate = path.join(directory, safeName)
  for (let index = 1; fs.existsSync(candidate) || [...downloads.values()].some((download) => download.savePath === candidate); index += 1) {
    candidate = path.join(directory, `${parsed.name} (${index})${parsed.ext}`)
  }
  return candidate
}

function attachDownloadManager(target: Session): void {
  if (downloadSessions.has(target)) return
  downloadSessions.add(target)
  target.on('will-download', (_event, item) => {
    const id = randomUUID()
    const filename = path.basename(item.getFilename()) || 'download'
    const savePath = availableDownloadPath(filename)
    item.setSavePath(savePath)
    const summary: DownloadSummary = {
      id,
      filename,
      url: item.getURL(),
      savePath,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      status: 'progressing',
      startedAt: Date.now(),
    }
    downloadItems.set(id, item)
    downloads.set(id, summary)
    broadcast('browser:download', summary)

    item.on('updated', (_downloadEvent, status) => {
      summary.receivedBytes = item.getReceivedBytes()
      summary.totalBytes = item.getTotalBytes()
      summary.status = status === 'interrupted' ? 'interrupted' : 'progressing'
      broadcast('browser:download', { ...summary })
    })

    item.once('done', (_downloadEvent, status) => {
      summary.receivedBytes = item.getReceivedBytes()
      summary.totalBytes = item.getTotalBytes()
      summary.status = status
      downloadItems.delete(id)
      broadcast('browser:download', { ...summary })
    })
  })
}

function setupDownloadManager(): void {
  attachDownloadManager(session.fromPartition('persist:enpii-browser'))
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') attachDownloadManager(contents.session)
  })
}

app.whenReady().then(() => {
  installAppMenu()
  enpii.start()

  enpii.on('log', (line: string) => {
    broadcast('enpii:log', line)
  })

  enpii.on('notification', (msg: unknown) => {
    broadcast('enpii:event', msg)
  })

  enpii.on('exit', (info: unknown) => {
    broadcast('enpii:exit', info)
  })

  ipcMain.handle('enpii:request', async (_evt, method: string, params?: unknown) => {
    return enpii.request(method, params)
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle('dialog:openFiles', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Supported documents', extensions: ['txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'toml', 'js', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'css', 'html', 'php', 'py', 'csv', 'xml', 'sql', 'sh', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    })
    if (res.canceled) return []
    return parseAttachmentPaths(res.filePaths)
  })

  ipcMain.handle('dialog:parseFiles', (_evt, filePaths: unknown) => parseAttachmentPaths(filePaths))

  ipcMain.handle('dialog:saveTextFile', async (_evt, opts?: {
    defaultPath?: string
    content?: string
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const res = await dialog.showSaveDialog({
      defaultPath: opts?.defaultPath,
      filters: opts?.filters ?? [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (res.canceled || !res.filePath) return null
    fs.writeFileSync(res.filePath, opts?.content ?? '', 'utf8')
    return res.filePath
  })

  ipcMain.handle('shell:openPath', async (_evt, p: string) => {
    return shell.openPath(p)
  })

  ipcMain.handle('browser:downloads:list', () => [...downloads.values()])

  ipcMain.handle('browser:downloads:cancel', (_evt, id: string) => {
    downloadItems.get(id)?.cancel()
  })

  ipcMain.handle('browser:downloads:open', async (_evt, id: string) => {
    const download = downloads.get(id)
    if (!download || download.status !== 'completed') return 'Download unavailable'
    return shell.openPath(download.savePath)
  })

  ipcMain.handle('browser:downloads:reveal', (_evt, id: string) => {
    const download = downloads.get(id)
    if (!download || !fs.existsSync(download.savePath)) return false
    shell.showItemInFolder(download.savePath)
    return true
  })

  ipcMain.handle(
    'terminal:create',
    (
      _evt,
      params?: {
        cwd?: string
        cols?: number
        rows?: number
        /** Optional program to run instead of login shell (vendor CLI host). */
        command?: string
        args?: string[]
        /** Inject Settings baseUrl/model/apiKey into env + --model for vendor CLIs. */
        injectProvider?: boolean
        /** Per-launch override (vendor config modal). Falls back to Settings file/env. */
        provider?: VendorProviderOverride
      },
    ) => {
      const cwd = path.resolve(params?.cwd ?? app.getPath('home'))
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`terminal cwd not found: ${cwd}`)
      }
      const defaultShell =
        process.platform === 'win32'
          ? process.env.COMSPEC ?? 'powershell.exe'
          : process.env.SHELL ?? '/bin/bash'
      const requested = params?.command?.trim() || defaultShell
      const command = resolveSpawnCommand(requested)
      let args = Array.isArray(params?.args) ? params!.args!.map(String) : []
      let extraEnv: Record<string, string> = {}
      if (params?.injectProvider && params?.command?.trim()) {
        const injected = vendorProviderInject(command, cwd, args, params.provider)
        extraEnv = injected.env
        args = injected.args
      }
      if (params?.command?.trim() && !fs.existsSync(command) && !command.includes(path.sep)) {
        throw new Error(`Command not found: ${requested}`)
      }
      const id = randomUUID()
      const terminal = pty.spawn(command, args, {
        name: 'xterm-256color',
        cwd,
        cols: Math.max(2, params?.cols ?? 80),
        rows: Math.max(1, params?.rows ?? 24),
        env: {
          ...cleanEnv(),
          ...extraEnv,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      })
      terminals.set(id, terminal)
      terminal.onData((data) => broadcast('terminal:data', { id, data }))
      terminal.onExit(({ exitCode, signal }) => {
        terminals.delete(id)
        broadcast('terminal:exit', { id, exitCode, signal })
      })
      return { id, shell: path.basename(command), cwd, command, args }
    },
  )

  ipcMain.handle('terminal:write', (_evt, id: string, data: string) => {
    terminals.get(id)?.write(data)
  })

  ipcMain.handle('terminal:resize', (_evt, id: string, cols: number, rows: number) => {
    terminals.get(id)?.resize(Math.max(2, cols), Math.max(1, rows))
  })

  ipcMain.handle('terminal:kill', (_evt, id: string) => {
    const terminal = terminals.get(id)
    if (!terminal) return
    terminals.delete(id)
    terminal.kill()
  })

  /** PATH command basenames (cached). Optional prefix → filtered completions. */
  ipcMain.handle('terminal:pathComplete', (_evt, prefix?: string) => {
    const p = typeof prefix === 'string' ? prefix : ''
    if (p.trim()) return pathComplete(p, 25)
    return listPathBins().slice(0, 500)
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:setMode', (_evt, mode: unknown) => {
    rendererMode = typeof mode === 'string' ? mode : 'agent'
  })

  /** Browser workspace under project `.enpii/browser.json` (tabs/bookmarks/history). */
  ipcMain.handle('browser:workspace:load', (_evt, projectRoot?: string) => {
    const root = typeof projectRoot === 'string' ? projectRoot.trim() : ''
    if (!root) return null
    const file = path.join(path.resolve(root), '.enpii', 'browser.json')
    try {
      if (!fs.existsSync(file)) return null
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
      return raw && typeof raw === 'object' ? raw : null
    } catch {
      return null
    }
  })
  ipcMain.handle('browser:workspace:save', (_evt, projectRoot?: string, data?: unknown) => {
    const root = typeof projectRoot === 'string' ? projectRoot.trim() : ''
    if (!root || data == null || typeof data !== 'object') return false
    const dir = path.join(path.resolve(root), '.enpii')
    const file = path.join(dir, 'browser.json')
    try {
      fs.mkdirSync(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      fs.renameSync(tmp, file)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('app:windowMinimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  ipcMain.handle('app:windowMaximizeToggle', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('app:windowClose', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })
  ipcMain.handle('app:windowIsMaximized', () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
  })

  ipcMain.handle('app:showNotification', (_evt, opts?: {
    title?: string
    body?: string
    urgency?: 'normal' | 'critical' | 'low'
  }) => {
    if (!Notification.isSupported()) return false
    const title = opts?.title?.trim() || 'enpiistudio'
    const n = new Notification({
      title,
      body: opts?.body?.slice(0, 240) || '',
      urgency: opts?.urgency ?? 'normal',
    })
    n.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    })
    n.show()
    return true
  })

  setupDownloadManager()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killTerminals()
  enpii.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  killTerminals()
  enpii.stop()
})
