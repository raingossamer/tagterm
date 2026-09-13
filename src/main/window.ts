/**
 * 平台层：主窗口。安全参数一次到位（contextIsolation / sandbox / 无 nodeIntegration）；
 * 非退出状态下点 × 只隐藏到托盘，所有 pty 与终端内容原样保留。
 */
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import iconPath from '../../resources/icon.ico?asset'

export interface MainWindowDeps {
  /** 关闭请求时是否应隐藏而非销毁（应用正在退出时返回 false） */
  shouldHideOnClose: () => boolean
  /** 首帧就绪后是否显示窗口；开机自启（--hidden）时为 false，静默留在托盘。缺省 true */
  showOnReady?: boolean
}

export function createMainWindow(deps: MainWindowDeps): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#E9ECF0',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => {
    if (deps.showOnReady ?? true) win.show()
  })
  win.on('close', (e) => {
    if (deps.shouldHideOnClose()) {
      e.preventDefault()
      win.hide()
    }
  })

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

/** 从托盘 / 二次启动恢复窗口：还原最小化、显示并聚焦 */
export function showMainWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
