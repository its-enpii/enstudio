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
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { EnpiiClient } from './enpiiClient'
import { listPathBins, pathComplete } from './pathBins'
import { TerminalHost } from './terminal/terminalHost'
import type { TerminalCreateParams, VendorProviderOverride } from './terminal/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
const enpii = new EnpiiClient()
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

type VendorLiteConfig = { baseUrl?: string; apiKey?: string; model?: string }

function readVendorSection(rawToml: string, sectionKey: string): VendorLiteConfig {
  const get = (keys: string[]) => {
    for (const key of keys) {
      const m = rawToml.match(new RegExp(`^\\s*\[${sectionKey.replace(/\./g, '\\.')}\][\\s\\S]*?^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))
      if (m?.[1] !== undefined) return m[1]
    }
    return undefined
  }
  return {
    baseUrl: get(['baseUrl', 'base_url']),
    apiKey: get(['apiKey', 'api_key']),
    model: get(['model']),
  }
}

/** Minimal Settings read (json + simple toml keys + vendor sections). Priority matches agent-core. */
function readProviderLite(cwd: string, vendorName?: string, target: 'main' | 'subagent' = 'main'): { baseUrl?: string; apiKey?: string; model?: string } {
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
  const tomlUserFile = path.join(home, 'config.toml')
  const tomlProjFile = path.join(cwd, '.enpii', 'config.toml')
  const userTomlRaw = fs.existsSync(tomlUserFile) ? fs.readFileSync(tomlUserFile, 'utf8') : ''
  const projTomlRaw = fs.existsSync(tomlProjFile) ? fs.readFileSync(tomlProjFile, 'utf8') : ''

  const vName = vendorName ?? 'enpii'
  const vUserMain = userTomlRaw ? readVendorSection(userTomlRaw, `vendors.${vName}.main`) : {}
  const vUserSub = userTomlRaw ? readVendorSection(userTomlRaw, `vendors.${vName}.subagent`) : {}
  const vProjMain = projTomlRaw ? readVendorSection(projTomlRaw, `vendors.${vName}.main`) : {}
  const vProjSub = projTomlRaw ? readVendorSection(projTomlRaw, `vendors.${vName}.subagent`) : {}

  const vUserTarget = target === 'subagent' ? (vUserSub.baseUrl || vUserSub.model || vUserSub.apiKey ? vUserSub : vUserMain) : vUserMain
  const vProjTarget = target === 'subagent' ? (vProjSub.baseUrl || vProjSub.model || vProjSub.apiKey ? vProjSub : vProjMain) : vProjMain

  const layers = [
    fromJson(path.join(home, 'config.json')),
    fromToml(tomlUserFile),
    vUserTarget,
    fromToml(tomlProjFile),
    vProjTarget,
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

/** Env + argv flags so vendor CLIs follow enpii Settings (base URL / model / key). */
function vendorProviderInject(
  command: string,
  cwd: string,
  args: string[],
  override?: VendorProviderOverride,
): { env: Record<string, string>; args: string[] } {
  const bin = path.basename(command).replace(/\.(cmd|exe)$/i, '').toLowerCase()
  const vendorName = bin === 'claude' ? 'claude' : bin === 'codex' ? 'codex' : bin === 'opencode' ? 'opencode' : bin === 'gemini' ? 'gemini' : 'enpii'
  const file = readProviderLite(cwd, vendorName, 'main')
  const subFile = readProviderLite(cwd, vendorName, 'subagent')
  const cfg = {
    baseUrl: override?.baseUrl?.trim() || file.baseUrl,
    apiKey: override?.apiKey?.trim() || file.apiKey,
    model: override?.model?.trim() || file.model,
  }
  const env: Record<string, string> = {}

  if (vendorName === 'claude') {
    if (cfg.baseUrl) env.ANTHROPIC_BASE_URL = cfg.baseUrl
    if (cfg.apiKey) env.ANTHROPIC_API_KEY = cfg.apiKey
    if (cfg.model) {
      env.CLAUDE_MODEL = cfg.model
      env.ANTHROPIC_MODEL = cfg.model
    }
    if (subFile.model) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = subFile.model
    }
  } else if (vendorName === 'codex' || vendorName === 'opencode') {
    if (cfg.baseUrl) {
      env.OPENAI_BASE_URL = cfg.baseUrl
      env.OPENAI_API_BASE = cfg.baseUrl
    }
    if (cfg.apiKey) env.OPENAI_API_KEY = cfg.apiKey
    if (cfg.model) env.OPENAI_MODEL = cfg.model
  } else if (vendorName === 'gemini') {
    if (cfg.baseUrl) env.GEMINI_BASE_URL = cfg.baseUrl
    if (cfg.apiKey) {
      env.GEMINI_API_KEY = cfg.apiKey
      env.GOOGLE_API_KEY = cfg.apiKey
    }
    if (cfg.model) env.GEMINI_MODEL = cfg.model
  } else {
    if (cfg.baseUrl) env.ENPII_BASE_URL = cfg.baseUrl
    if (cfg.apiKey) env.ENPII_API_KEY = cfg.apiKey
    if (cfg.model) env.ENPII_MODEL = cfg.model
  }

  const nextArgs = [...args]
  const hasModelFlag = nextArgs.some((a) => a === '--model' || a === '-m' || a.startsWith('--model='))
  if (cfg.model && !hasModelFlag) {
    nextArgs.push('--model', cfg.model)
  }
  return { env, args: nextArgs }
}

const terminalHost = new TerminalHost({
  homeDirectory: () => app.getPath('home'),
  runtimeDirectory: () => app.getPath('temp'),
  broadcast: ({ channel, payload }) => broadcast(channel, payload),
  injectVendorProvider: vendorProviderInject,
  // Snapshot the live Node.js env here, BEFORE Vite's bundling mangles
  // `process.env` into a static object literal in the emitted bundle.
  // We read it through `Function('return process.env')` so Vite/Rollup
  // can't statically fold it to an empty object during build.
  parentEnv: (Function('return process.env')() as NodeJS.ProcessEnv),
  workerBundlePath: async () => {
    // Bundled worker sits next to main.cjs when run from vite dist-electron;
    // in dev mode the worker source is co-located and we let vite-plugin-electron
    // produce the bundle alongside main.cjs.
    const candidates = [
      path.join(__dirname, 'terminalWorker.cjs'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    throw new Error(`terminal worker bundle not found in ${__dirname}`)
  },
})

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
    title: 'EnStudio',
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
    // open DevTools only when explicitly requested. `process.env.ENPII_DEVTOOLS`
    // is mangled by Vite at build time (replaced with a static empty object),
    // so we read the real runtime env via `Function('return process.env')()`
    // which Vite cannot statically analyze.
    const liveEnv = (Function('return process.env')() as NodeJS.ProcessEnv)
    if (liveEnv.ENPII_DEVTOOLS === '1') {
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

// electron-updater is a CJS module; dynamic-import keeps the ESM build happy
// and lets us skip it cleanly in dev mode.
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null

async function setupAutoUpdater(): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) return
  try {
    const mod = await import('electron-updater')
    autoUpdater = mod.autoUpdater
  } catch (err) {
    // Module not installed yet (first run before npm install completes, or
    // packaging without the dep). Fail open — UI will show "check failed".
    broadcast('app:update:error', err instanceof Error ? err.message : String(err))
    return
  }
  if (!autoUpdater) return

  // User triggers download manually — no surprise bandwidth.
  autoUpdater.autoDownload = false
  // If user quits with a downloaded update waiting, finish the install.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: { version: string; releaseNotes?: string | null }) => {
    broadcast('app:update:available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })
  autoUpdater.on('download-progress', (progress: { percent: number; transferred: number; total: number }) => {
    broadcast('app:update:progress', progress)
  })
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    broadcast('app:update:downloaded', { version: info.version })
  })
  autoUpdater.on('error', (err: Error) => {
    broadcast('app:update:error', err.message)
  })

  // GitHub Releases feed is picked up from electron-builder `publish` config
  // in package.json, but setFeedURL also works explicitly if you ever need to
  // override (e.g. staging channel).
  // autoUpdater.setFeedURL({ provider: 'github', owner: 'its-enpii', repo: 'enstudio' })
}

function readWindowsEnv(): NodeJS.ProcessEnv {
  // Electron on Windows doesn't inherit the user's PATH/ComSpec when
  // launched by `pnpm dev` → node → electron.exe. node-pty then spawns
  // cmd.exe without PATH so commands like `docker`, `npm`, `git` fail
  // with "is not recognized". Read the canonical Windows PATH from BOTH
  // the user (HKCU\Environment) and system
  // (HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment)
  // registries — that's what `cmd.exe` would expose to a fresh console —
  // and merge them into process.env before we hand it to the worker.
  if (process.platform !== 'win32') return process.env
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  const readReg = (key: string, value: string): string | undefined => {
    try {
      const raw = execFileSync('reg.exe', ['query', key, '/v', value], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const match = raw.match(new RegExp(`${value}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\r?\\n`))
      return match?.[1]?.trim() || undefined
    } catch {
      return undefined
    }
  }
  const userPath = readReg('HKCU\\Environment', 'PATH')
  const systemPath = readReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path')
  const merged = [process.env.PATH, systemPath, userPath].filter((p): p is string => Boolean(p)).join(';')
  if (merged) process.env.PATH = merged
  process.env.ComSpec = process.env.ComSpec ?? (process.env.SystemRoot ?? 'C:\\Windows') + '\\System32\\cmd.exe'
  // eslint-disable-next-line no-console
  console.log('[main] resolved PATH length=', process.env.PATH?.length, 'has docker:', process.env.PATH?.toLowerCase().includes('docker'))
  return process.env
}

app.whenReady().then(() => {
  readWindowsEnv()
  installAppMenu()
  enpii.start()
  void terminalHost.start().catch((err: unknown) => {
    console.error('[terminalHost] failed to start', err)
  })

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
    async (_evt, params?: TerminalCreateParams) => {
      await terminalHost.start()
      return terminalHost.create(params)
    },
  )

  ipcMain.handle('terminal:write', (_evt, id: unknown, data: unknown) => {
    terminalHost.write(id, data)
  })

  ipcMain.handle('terminal:resize', (_evt, id: unknown, cols: unknown, rows: unknown) => {
    terminalHost.resize(id, cols, rows)
  })

  ipcMain.handle('terminal:kill', (_evt, id: unknown) => {
    terminalHost.kill(id)
  })

  ipcMain.handle('terminal:list', (_evt, projectId?: unknown, purpose?: unknown) => {
    return terminalHost.list(projectId, purpose)
  })

  ipcMain.handle('terminal:subscribe', (_evt, id: unknown, afterSequence?: unknown) => {
    return terminalHost.subscribe(id, afterSequence)
  })

  ipcMain.handle('terminal:acknowledge', (_evt, id: unknown, sequence: unknown) => {
    terminalHost.acknowledge(id, sequence)
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
    const title = opts?.title?.trim() || 'EnStudio'
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

  // In-app update via electron-updater. Dev mode (VITE_DEV_SERVER_URL) is
  // excluded so a running dev build can't be clobbered by an auto-update.
  ipcMain.handle('app:update:check', () => {
    if (process.env.VITE_DEV_SERVER_URL) return false
    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      broadcast('app:update:error', err instanceof Error ? err.message : String(err))
    })
    return true
  })

  ipcMain.handle('app:update:download', () => {
    if (process.env.VITE_DEV_SERVER_URL) return false
    void autoUpdater.downloadUpdate().catch((err: unknown) => {
      broadcast('app:update:error', err instanceof Error ? err.message : String(err))
    })
    return true
  })

  ipcMain.handle('app:update:install', () => {
    if (process.env.VITE_DEV_SERVER_URL) return false
    // isForce=false: graceful, lets the user finish any pending work.
    autoUpdater.quitAndInstall(false)
    return true
  })

  setupDownloadManager()
  setupAutoUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  terminalHost.killAll()
  enpii.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  terminalHost.killAll()
  enpii.stop()
})
