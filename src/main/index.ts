/**
 * 装配层：创建各服务、注入依赖、绑定 app 生命周期；不含业务逻辑。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import * as nodePty from 'node-pty'
import { createMainWindow } from './window'
import { registerIpc } from './ipc'
import { runSmokeCheck } from './smoke'
import { SessionStore } from './store/SessionStore'
import { resolveDataDir } from './store/paths'
import { detectAvailableShells } from './shells'

// 顶层异常：记录日志 + 弹框，不静默
process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常', err)
  dialog.showErrorBox('TagTerm 出错', err?.stack ?? String(err))
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝', reason)
})

/** 证明原生模块在 Electron 下可用（Slice 1 验收项） */
function logNativeModules(): void {
  console.log(`[pty] node-pty 已加载（spawn: ${typeof nodePty.spawn}）`)
}

let mainWindow: BrowserWindow | null = null

/** 主进程是持久数据的真相源：变更后向渲染进程广播全量列表 */
function broadcast(channel: 'session:changed', payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

async function pickDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
    title: '选择会话目录',
    properties: ['openDirectory'],
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

app.whenReady().then(async () => {
  logNativeModules()

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

  const availableShells = detectAvailableShells(process.env['PATH'] ?? '', existsSync)
  console.log(`[main] 可用 shell：${availableShells.join(', ') || '无'}`)

  registerIpc(ipcMain, {
    version: app.getVersion(),
    store,
    pickDirectory,
    listShells: () => availableShells,
  })

  mainWindow = createMainWindow()
  if (process.env['TAGTERM_SMOKE']) runSmokeCheck(mainWindow)
})

// S5 引入托盘后改为常驻；此前关闭窗口即退出
app.on('window-all-closed', () => {
  app.quit()
})
