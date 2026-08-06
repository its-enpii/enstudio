import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron'
import type {
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionSnapshot,
  TerminalShellMarkerEvent,
  TerminalSubscriptionSnapshot,
} from './terminal/types'

export type EnpiiEventHandler = (payload: unknown) => void

const api = {
  enpii: {
    request: (method: string, params?: unknown) =>
      ipcRenderer.invoke('enpii:request', method, params) as Promise<unknown>,
    onEvent: (handler: EnpiiEventHandler) => {
      const listener = (_: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
      ipcRenderer.on('enpii:event', listener)
      return () => ipcRenderer.removeListener('enpii:event', listener)
    },
    onLog: (handler: EnpiiEventHandler) => {
      const listener = (_: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
      ipcRenderer.on('enpii:log', listener)
      return () => ipcRenderer.removeListener('enpii:log', listener)
    },
    onExit: (handler: EnpiiEventHandler) => {
      const listener = (_: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
      ipcRenderer.on('enpii:exit', listener)
      return () => ipcRenderer.removeListener('enpii:exit', listener)
    },
  },
  dialog: {
    openDirectory: () =>
      ipcRenderer.invoke('dialog:openDirectory') as Promise<string | null>,
    openFiles: () => ipcRenderer.invoke('dialog:openFiles') as Promise<ComposerAttachment[]>,
    parseFiles: (paths: string[]) => ipcRenderer.invoke('dialog:parseFiles', paths) as Promise<ComposerAttachment[]>,
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    saveTextFile: (opts: { defaultPath?: string; content: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:saveTextFile', opts) as Promise<string | null>,
  },
  shell: {
    openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p) as Promise<string>,
  },
  terminal: {
    create: (
      cwd: string,
      cols: number,
      rows: number,
      opts?: Omit<TerminalCreateParams, 'cwd' | 'cols' | 'rows'>,
    ) =>
      ipcRenderer.invoke('terminal:create', {
        projectId: opts?.projectId,
        purpose: opts?.purpose,
        cwd,
        cols,
        rows,
        command: opts?.command,
        args: opts?.args,
        injectProvider: opts?.injectProvider,
        provider: opts?.provider,
      } satisfies TerminalCreateParams) as Promise<TerminalCreateResult>,
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data) as Promise<void>,
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows) as Promise<void>,
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id) as Promise<void>,
    list: (projectId?: string, purpose?: 'terminal' | 'vendor') =>
      ipcRenderer.invoke('terminal:list', projectId, purpose) as Promise<TerminalSessionSnapshot[]>,
    subscribe: (id: string, afterSequence = 0) =>
      ipcRenderer.invoke('terminal:subscribe', id, afterSequence) as Promise<TerminalSubscriptionSnapshot>,
    acknowledge: (id: string, sequence: number) =>
      ipcRenderer.invoke('terminal:acknowledge', id, sequence) as Promise<void>,
    /** PATH command complete. With prefix → up to 25 matches; empty → sample list. */
    pathComplete: (prefix?: string) =>
      ipcRenderer.invoke('terminal:pathComplete', prefix ?? '') as Promise<string[]>,
    onData: (handler: (payload: TerminalDataEvent) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: TerminalDataEvent) => handler(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (handler: (payload: TerminalExitEvent) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: TerminalExitEvent) => handler(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },
    onShellMarker: (handler: (payload: TerminalShellMarkerEvent) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: TerminalShellMarkerEvent) => handler(payload)
      ipcRenderer.on('terminal:shellMarker', listener)
      return () => ipcRenderer.removeListener('terminal:shellMarker', listener)
    },
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
    setMode: (mode: string) => ipcRenderer.invoke('app:setMode', mode) as Promise<void>,
    showNotification: (opts: { title: string; body?: string; urgency?: 'normal' | 'critical' | 'low' }) =>
      ipcRenderer.invoke('app:showNotification', opts) as Promise<boolean>,
    windowMinimize: () => ipcRenderer.invoke('app:windowMinimize') as Promise<void>,
    windowMaximizeToggle: () => ipcRenderer.invoke('app:windowMaximizeToggle') as Promise<boolean>,
    windowClose: () => ipcRenderer.invoke('app:windowClose') as Promise<void>,
    windowIsMaximized: () => ipcRenderer.invoke('app:windowIsMaximized') as Promise<boolean>,
    /** Electron page zoom (not CSS zoom — CSS zoom breaks text selection). 1 = 100%.
     *  webFrame.setZoomFactor schedules the layout reflow asynchronously; the
     *  renderer fires `enpiistudio:zoom-applied` once the new geometry is live
     *  so consumers (terminal fit, editor fit, …) can re-measure on the right tick. */
    setZoomFactor: (factor: number) => {
      const f = Number(factor)
      if (!Number.isFinite(f) || f <= 0) return
      webFrame.setZoomFactor(Math.min(3, Math.max(0.5, f)))
      // 2 RAFs is the empirically-stable wait on Win/Mac for webFrame to settle.
      // The preload runs in an isolated world but shares the page's window —
      // we schedule the dispatch via webFrame's setTimeout-like timer so it
      // runs on the next frame boundary (avoids contextBridge `window` typing).
      setTimeout(() => {
        setTimeout(() => {
          // `globalThis` resolves to the page's window in the preload's isolated world.
          const w = globalThis as unknown as { dispatchEvent: (ev: Event) => boolean }
          w.dispatchEvent(
            new CustomEvent('enpiistudio:zoom-applied', { detail: { factor: webFrame.getZoomFactor() } }),
          )
        }, 32)
      }, 32)
    },
    getZoomFactor: () => webFrame.getZoomFactor(),
    /** In-app update via electron-updater. IPC returns false in dev (VITE_DEV_SERVER_URL). */
    update: {
      check: () => ipcRenderer.invoke('app:update:check') as Promise<boolean>,
      download: () => ipcRenderer.invoke('app:update:download') as Promise<boolean>,
      install: () => ipcRenderer.invoke('app:update:install') as Promise<boolean>,
      onAvailable: (handler: (info: { version: string; releaseNotes?: string }) => void) => {
        const listener = (_: Electron.IpcRendererEvent, payload: { version: string; releaseNotes?: string }) =>
          handler(payload)
        ipcRenderer.on('app:update:available', listener)
        return () => ipcRenderer.removeListener('app:update:available', listener)
      },
      onDownloaded: (handler: (info: { version: string }) => void) => {
        const listener = (_: Electron.IpcRendererEvent, payload: { version: string }) => handler(payload)
        ipcRenderer.on('app:update:downloaded', listener)
        return () => ipcRenderer.removeListener('app:update:downloaded', listener)
      },
      onProgress: (handler: (progress: { percent: number; transferred: number; total: number }) => void) => {
        const listener = (
          _: Electron.IpcRendererEvent,
          payload: { percent: number; transferred: number; total: number },
        ) => handler(payload)
        ipcRenderer.on('app:update:progress', listener)
        return () => ipcRenderer.removeListener('app:update:progress', listener)
      },
      onError: (handler: (message: string) => void) => {
        const listener = (_: Electron.IpcRendererEvent, message: string) => handler(message)
        ipcRenderer.on('app:update:error', listener)
        return () => ipcRenderer.removeListener('app:update:error', listener)
      },
    },
  },
  browser: {
    onShortcut: (handler: (shortcut: string) => void) => {
      const listener = (_evt: Electron.IpcRendererEvent, shortcut: string) => handler(shortcut)
      ipcRenderer.on('browser:shortcut', listener)
      return () => ipcRenderer.removeListener('browser:shortcut', listener)
    },
    workspace: {
      load: (projectRoot: string) =>
        ipcRenderer.invoke('browser:workspace:load', projectRoot) as Promise<Record<string, unknown> | null>,
      save: (projectRoot: string, data: unknown) =>
        ipcRenderer.invoke('browser:workspace:save', projectRoot, data) as Promise<boolean>,
    },
    downloads: {
      list: () => ipcRenderer.invoke('browser:downloads:list') as Promise<BrowserDownload[]>,
      cancel: (id: string) => ipcRenderer.invoke('browser:downloads:cancel', id) as Promise<void>,
      open: (id: string) => ipcRenderer.invoke('browser:downloads:open', id) as Promise<string>,
      reveal: (id: string) => ipcRenderer.invoke('browser:downloads:reveal', id) as Promise<boolean>,
      onChange: (handler: (download: BrowserDownload) => void) => {
        const listener = (_evt: Electron.IpcRendererEvent, download: BrowserDownload) => handler(download)
        ipcRenderer.on('browser:download', listener)
        return () => ipcRenderer.removeListener('browser:download', listener)
      },
    },
  },
}

export type ComposerAttachment = {
  name: string
  size: number
  kind: 'text' | 'image'
  content: string
  images?: { name: string; mime: string; dataUrl: string }[]
  error?: string
}

export type BrowserDownload = {
  id: string
  filename: string
  url: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  status: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
}

contextBridge.exposeInMainWorld('enpiistudio', api)

export type EnpiistudioApi = typeof api
