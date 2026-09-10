/**
 * 无人值守烟测：设置 TAGTERM_SMOKE=1 启动时，页面加载后核查安全基线与三层贯通
 * （含真实的会话新建 → 打开两个终端 → 切换 / 关闭标签页 → 中文 echo 往返 → 移除），
 * 以 JSON 打印到 stdout 后退出。生产运行不触发。
 */
import { app, type BrowserWindow } from 'electron'

const SMOKE_SCRIPT = `(async () => {
  const api = window.tagterm
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => [...document.querySelectorAll(sel)]
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (cond, timeoutMs = 8000) => {
    const start = Date.now()
    while (!cond()) {
      if (Date.now() - start > timeoutMs) return false
      await sleep(50)
    }
    return true
  }
  const outputs = {}
  let dataEvents = 0
  api.pty.onData((id, d) => { outputs[id] = (outputs[id] ?? '') + d; dataEvents += 1 })

  const before = await api.session.list()
  const s1 = await api.session.create({ cwd: 'C:\\\\Windows\\\\Temp', name: 'smoke-临时' })
  const s2 = await api.session.create({ cwd: 'C:\\\\Windows', name: 'smoke-2' })
  await sleep(200)
  const rowCount = $$('[data-test=session-row]').length
  const statusSessions = $('[data-test=status-sessions]')?.textContent ?? null

  // 打开第一个会话 → 真实 cmd.exe
  $$('[data-test=session-row]')[0]?.click()
  const gotPrompt1 = await waitFor(() => /C:\\\\Windows\\\\Temp>/.test(outputs[s1.id] ?? ''))
  api.pty.write(s1.id, 'echo 你好，TagTerm\\r')
  const gotEcho = await waitFor(() => (outputs[s1.id] ?? '').includes('你好，TagTerm'))

  // 打开第二个会话 → 两个实例并存，只有一个可见
  $$('[data-test=session-row]')[1]?.click()
  const gotPrompt2 = await waitFor(() => /C:\\\\Windows>/.test(outputs[s2.id] ?? ''))
  await sleep(100)
  const hosts = [...($('[data-test=terminal-pane]')?.children ?? [])]
  const visibleHosts = hosts.filter((h) => h.style.display === 'block').length
  const tabNames = $$('[data-test=tab-name]').map((t) => t.textContent)
  const activeTab = $('[data-test=tab].active [data-test=tab-name]')?.textContent ?? null

  // 切回第一个标签页，再关闭第二个标签页：pty 仍存活
  $$('[data-test=tab]')[0]?.click()
  await sleep(50)
  const activeAfterSwitch = $('[data-test=tab].active [data-test=tab-name]')?.textContent ?? null
  $$('[data-test=tab-close]')[1]?.click()
  await sleep(50)
  const tabsAfterClose = $$('[data-test=tab]').length
  const s2AliveAfterClose = await api.pty.isAlive(s2.id)
  const hostsAfterClose = ($('[data-test=terminal-pane]')?.children ?? []).length

  // 唤起区、清屏、侧栏收起
  const launchers = $$('[data-test=launch-agent]').map((b) => b.textContent.trim())
  $('[data-test=tab-side]')?.click()
  await sleep(50)
  const sideHidden = $('.app')?.classList.contains('side-hidden') ?? null
  $('[data-test=tab-side]')?.click()

  const hasXterm = !!$('[data-test=terminal-pane] .xterm')
  const hasCanvas = !!$('[data-test=terminal-pane] canvas')

  await api.session.remove(s1.id)
  await api.session.remove(s2.id)
  await sleep(100)
  const after = await api.session.list()
  const hostsAfterRemove = ($('[data-test=terminal-pane]')?.children ?? []).length
  const emptyAfterRemove = !!$('[data-test=empty-title]')
  return {
    hasProcess: typeof window.process !== 'undefined',
    hasRequire: typeof window.require !== 'undefined',
    hasApi: typeof api === 'object' && api !== null,
    version: await api.app.getVersion(),
    osBuild: await api.app.getOsBuild(),
    shells: await api.app.listShells(),
    statusVersion: $('[data-test=status-version]')?.textContent ?? null,
    sessionRoundTrip: { before: before.length, rowCountAfterCreate: rowCount, statusAfterCreate: statusSessions, after: after.length },
    terminal: { gotPrompt1, gotEcho, gotPrompt2, hosts: hosts.length, visibleHosts, hasXterm, hasCanvas, dataEvents },
    tabs: { tabNames, activeTab, activeAfterSwitch, tabsAfterClose, s2AliveAfterClose, hostsAfterClose },
    strip: { launchers, sideHidden },
    cleanup: { hostsAfterRemove, emptyAfterRemove },
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
