/**
 * 无人值守烟测：设置 TAGTERM_SMOKE=1 启动时，页面加载后核查安全基线与三层贯通
 * （含一次真实的会话新建 → 打开终端 → 中文 echo 往返 → 移除），以 JSON 打印到 stdout 后退出。
 * 生产运行不触发。
 */
import { app, type BrowserWindow } from 'electron'

const SMOKE_SCRIPT = `(async () => {
  const api = window.tagterm
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (cond, timeoutMs = 8000) => {
    const start = Date.now()
    while (!cond()) {
      if (Date.now() - start > timeoutMs) return false
      await sleep(50)
    }
    return true
  }
  let ptyOutput = ''
  let dataEvents = 0
  api.pty.onData((_id, d) => { ptyOutput += d; dataEvents += 1 })

  const before = await api.session.list()
  const created = await api.session.create({ cwd: 'C:\\\\Windows\\\\Temp', name: 'smoke-临时' })
  await sleep(200)
  const rowCount = document.querySelectorAll('[data-test=session-row]').length
  const statusSessions = document.querySelector('[data-test=status-sessions]')?.textContent ?? null

  // 点击会话行 → 打开终端（真实 cmd.exe）
  document.querySelector('[data-test=session-row]')?.click()
  const gotPrompt = await waitFor(() => /C:\\\\Windows\\\\Temp>/.test(ptyOutput))
  const hasXterm = !!document.querySelector('[data-test=terminal-pane] .xterm')
  const hasCanvas = !!document.querySelector('[data-test=terminal-pane] canvas')
  api.pty.write(created.id, 'echo 你好，TagTerm\\r')
  const gotEcho = await waitFor(() => ptyOutput.includes('你好，TagTerm'))
  const alive = await api.pty.isAlive(created.id)

  await api.session.remove(created.id)
  const after = await api.session.list()
  return {
    hasProcess: typeof window.process !== 'undefined',
    hasRequire: typeof window.require !== 'undefined',
    hasApi: typeof api === 'object' && api !== null,
    version: await api.app.getVersion(),
    osBuild: await api.app.getOsBuild(),
    shells: await api.app.listShells(),
    emptyTitle: document.querySelector('[data-test=empty-title]')?.textContent ?? null,
    statusVersion: document.querySelector('[data-test=status-version]')?.textContent ?? null,
    sessionRoundTrip: {
      before: before.length,
      createdName: created.name,
      rowCountAfterCreate: rowCount,
      statusAfterCreate: statusSessions,
      after: after.length,
    },
    terminal: { gotPrompt, hasXterm, hasCanvas, gotEcho, alive, dataEvents, outputBytes: ptyOutput.length },
  }
})()`

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
