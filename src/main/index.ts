/**
 * 装配层：创建各服务、注入依赖、绑定 app 生命周期；不含业务逻辑。
 * 会话生命周期 = 应用生命周期：关窗只隐藏到托盘；托盘「退出」与 before-quit 都 killAll。
 */
import { app, BrowserWindow, dialog, ipcMain, type Tray } from 'electron'
import { existsSync } from 'node:fs'
import { release } from 'node:os'
import type { EventArgs, EventChannel } from '@shared/ipc'
import { DEFAULT_AGENTS } from '@shared/models'
import { createMainWindow, showMainWindow } from './window'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { runSmokeCheck } from './smoke'
import { SessionStore } from './store/SessionStore'
import { resolveDataDir } from './store/paths'
import { PtyManager } from './pty/PtyManager'
import { detectAvailableShells, findOnPath } from './pathProbe'

// 顶层异常：记录日志 + 弹框，不静默
process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常', err)
  dialog.showErrorBox('TagTerm 出错', err?.stack ?? String(err))
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝', reason)
})

// 单实例锁：二次启动只聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

/** 主进程是持久数据与终端输出的来源：向渲染进程广播 */
function broadcast<K extends EventChannel>(channel: K, ...args: EventArgs<K>): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

async function pickDirectory(): Promise<string | null> {
  const options = { title: '选择会话目录', properties: ['openDirectory' as const] }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Windows 构建号：os.release() 形如 "10.0.26200" */
function osBuildNumber(): number {
  return Number(release().split('.')[2] ?? 0) || 0
}

function showWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) showMainWindow(mainWindow)
}

function quitApp(): void {
  isQuitting = true
  app.quit()
}

const ptyManager = new PtyManager({
  onData: (sessionId, data) => broadcast('pty:data', sessionId, data),
  onExit: (e) => broadcast('pty:exit', e),
})
console.log('[pty] node-pty 已加载')

app.whenReady().then(async () => {
  const store = new SessionStore(resolveDataDir(app.getPath('appData')), {
    onChanged: (sessions) => broadcast('session:changed', sessions),
  })
  try {
    await store.load()
  } catch (err) {
    // 坏文件不静默清空：提示后退出，由用户处理文件
    dialog.showErrorBox('TagTerm 无法加载数据', err instanceof Error ? err.message : String(err))
    app.exit(1)
    return
  }

  const pathEnv = process.env['PATH'] ?? ''
  const availableShells = detectAvailableShells(pathEnv, existsSync)
  const availableAgents = findOnPath(DEFAULT_AGENTS, pathEnv, existsSync)
  console.log(`[main] 可用 shell：${availableShells.join(', ') || '无'}`)
  console.log(`[main] 已安装的唤起工具：${availableAgents.join(', ') || '无'}`)

  registerIpc(ipcMain, {
    version: app.getVersion(),
    osBuild: osBuildNumber(),
    store,
    pty: ptyManager,
    pickDirectory,
    listShells: () => availableShells,
    listAgents: () => availableAgents,
  })

  mainWindow = createMainWindow({ shouldHideOnClose: () => !isQuitting })
  tray = createTray({ onShow: showWindow, onQuit: quitApp })
  if (process.env['TAGTERM_SMOKE'])
    runSmokeCheck(mainWindow, { store, pty: ptyManager, quit: quitApp })
})

app.on('second-instance', () => showWindow())

// 退出前结束全部终端，防孤儿 conhost（托盘「退出」也走这里）
app.on('before-quit', () => {
  isQuitting = true
  ptyManager.killAll()
  tray?.destroy()
  tray = null
})

// 常驻托盘：关闭窗口不退出
app.on('window-all-closed', () => {
  /* 保持运行，由托盘「退出」结束 */
})
