/**
 * 平台层：主窗口。安全参数一次到位（contextIsolation / sandbox / 无 nodeIntegration）。
 */
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#E9ECF0',
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  // 渲染进程不开新窗口；外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
