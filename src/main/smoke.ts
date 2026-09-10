/**
 * 无人值守烟测：设置 TAGTERM_SMOKE=1 启动时，页面加载后核查安全基线与三层贯通，
 * 以 JSON 打印到 stdout 后退出。生产运行不触发。
 */
import { app, type BrowserWindow } from 'electron'

const SMOKE_SCRIPT = `(async () => ({
  hasProcess: typeof window.process !== 'undefined',
  hasRequire: typeof window.require !== 'undefined',
  hasApi: typeof window.tagterm === 'object' && window.tagterm !== null,
  version: await window.tagterm.app.getVersion(),
  emptyTitle: document.querySelector('[data-test=empty-title]')?.textContent ?? null,
  statusVersion: document.querySelector('[data-test=status-version]')?.textContent ?? null,
  bodyFont: getComputedStyle(document.body).fontFamily,
}))()`

export function runSmokeCheck(win: BrowserWindow): void {
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message)
  })
  win.webContents.once('did-finish-load', async () => {
    // 等待 Vue 挂载与 IPC 往返
    await new Promise((r) => setTimeout(r, 800))
    try {
      const result = (await win.webContents.executeJavaScript(SMOKE_SCRIPT)) as Record<
        string,
        unknown
      >
      console.log('[smoke] ' + JSON.stringify({ ...result, consoleErrors }))
    } catch (err) {
      console.log('[smoke] ' + JSON.stringify({ error: String(err), consoleErrors }))
    }
    app.exit(0)
  })
}
