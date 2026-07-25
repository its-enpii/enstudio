import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EnpiiClient } from './enpiiClient'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
const enpii = new EnpiiClient()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#040303',
    title: 'enpiistudio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // open DevTools only when explicitly requested
    if (process.env.ENPII_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function broadcast(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

app.whenReady().then(() => {
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

  ipcMain.handle('shell:openPath', async (_evt, p: string) => {
    return shell.openPath(p)
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  enpii.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  enpii.stop()
})
