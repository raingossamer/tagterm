/**
 * 平台层：本周备忘小窗的 Electron 适配器（memo-floating-window 决策 2 / 3 / 5）。
 * 无边框、始终在最前、不占任务栏、可缩放（最小 300×260）；安全参数与主窗口一致，preload 只给备忘录用的那一份。
 * 系统的关闭请求（Alt+F4）交给服务（只隐藏），应用正在退出时才真的关。何时建、放在哪、开关语义都在 memo/MemoWindow。
 */
import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { MemoWindowEvents, MemoWindowHandle, MemoWindowPort } from '../memo/MemoWindow'
import { MEMO_WINDOW_MIN_SIZE, type Rect } from '../memo/memoWindowBounds'
import { isDevToolsToggle } from '../windowKeys'

export interface MemoWindowPortDeps {
  /** 主窗口（取它所在屏幕的工作区放默认位置） */
  mainWindow: () => BrowserWindow | null
  /** 应用正在退出时放行关闭，否则关闭请求只隐藏 */
  isQuitting: () => boolean
  /** F12 开关开发者工具：只在未打包时 */
  isDevToolsKeyEnabled?: boolean
  /** 窗口建好后回调（装配层把渲染进程的警告 / 错误接进日志、烟测拿它检查） */
  onCreated?: (win: BrowserWindow) => void
}

export function electronMemoWindows(deps: MemoWindowPortDeps): MemoWindowPort {
  return {
    workAreas: () => screen.getAllDisplays().map((d) => d.workArea),
    mainArea: () => {
      const main = deps.mainWindow()
      const display =
        main && !main.isDestroyed()
          ? screen.getDisplayMatching(main.getBounds())
          : screen.getPrimaryDisplay()
      return display.workArea
    },
    create: (bounds, events) => createMemoWindow(bounds, events, deps),
  }
}

function createMemoWindow(
  bounds: Rect,
  events: MemoWindowEvents,
  deps: MemoWindowPortDeps,
): MemoWindowHandle {
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MEMO_WINDOW_MIN_SIZE.width,
    minHeight: MEMO_WINDOW_MIN_SIZE.height,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '本周备忘',
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: join(__dirname, '../preload/memo.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.on('moved', () => events.onBoundsChanged())
  win.on('resized', () => events.onBoundsChanged())
  win.on('close', (e) => {
    if (deps.isQuitting()) return
    e.preventDefault()
    events.onCloseRequest()
  })
  if (deps.isDevToolsKeyEnabled) {
    win.webContents.on('before-input-event', (event, input) => {
      if (!isDevToolsToggle(input)) return
      event.preventDefault()
      win.webContents.toggleDevTools()
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/memo.html`)
  else void win.loadFile(join(__dirname, '../renderer/memo.html'))
  deps.onCreated?.(win)

  const alive = (): boolean => !win.isDestroyed()
  return {
    isVisible: () => alive() && win.isVisible(),
    isFocused: () => alive() && win.isFocused(),
    show: () => {
      if (!alive()) return
      win.show()
      win.focus()
    },
    showInactive: () => {
      if (alive()) win.showInactive()
    },
    focus: () => {
      if (alive()) win.focus()
    },
    hide: () => {
      if (alive()) win.hide()
    },
    getBounds: () => (alive() ? win.getBounds() : bounds),
    send: (channel, ...args) => {
      if (alive()) win.webContents.send(channel, ...args)
    },
  }
}
