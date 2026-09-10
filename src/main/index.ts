/**
 * 装配层：创建各服务、注入依赖、绑定 app 生命周期；不含业务逻辑。
 */
import { app, dialog, ipcMain } from 'electron'
import * as nodePty from 'node-pty'
import { createMainWindow } from './window'
import { registerIpc } from './ipc'
import { runSmokeCheck } from './smoke'

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

app.whenReady().then(() => {
  logNativeModules()
  registerIpc(ipcMain, { version: app.getVersion() })
  const win = createMainWindow()
  if (process.env['TAGTERM_SMOKE']) runSmokeCheck(win)
})

// S5 引入托盘后改为常驻；此前关闭窗口即退出
app.on('window-all-closed', () => {
  app.quit()
})
