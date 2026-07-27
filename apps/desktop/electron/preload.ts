import { contextBridge, ipcRenderer, webUtils } from 'electron'

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
      opts?: { command?: string; args?: string[]; injectProvider?: boolean },
    ) =>
      ipcRenderer.invoke('terminal:create', {
        cwd,
        cols,
        rows,
        command: opts?.command,
        args: opts?.args,
        injectProvider: opts?.injectProvider,
      }) as Promise<{ id: string; shell: string; cwd: string; command?: string; args?: string[] }>,
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data) as Promise<void>,
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows) as Promise<void>,
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id) as Promise<void>,
    onData: (handler: (payload: { id: string; data: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { id: string; data: string }) => handler(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (handler: (payload: { id: string; exitCode: number; signal?: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { id: string; exitCode: number; signal?: number }) => handler(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
    showNotification: (opts: { title: string; body?: string; urgency?: 'normal' | 'critical' | 'low' }) =>
      ipcRenderer.invoke('app:showNotification', opts) as Promise<boolean>,
  },
  browser: {
    onShortcut: (handler: (shortcut: string) => void) => {
      const listener = (_evt: Electron.IpcRendererEvent, shortcut: string) => handler(shortcut)
      ipcRenderer.on('browser:shortcut', listener)
      return () => ipcRenderer.removeListener('browser:shortcut', listener)
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
