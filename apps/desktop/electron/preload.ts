import { contextBridge, ipcRenderer } from 'electron'

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
  },
  shell: {
    openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p) as Promise<string>,
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
  },
}

contextBridge.exposeInMainWorld('enpiistudio', api)

export type EnpiistudioApi = typeof api
