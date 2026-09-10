/**
 * 无人值守烟测：设置 TAGTERM_SMOKE=1 启动时，页面加载后核查安全基线与三层贯通
 * （真实会话新建 → 打开两个终端 → 切换 / 关闭标签页 → 中文 echo 往返 → 右键 / Ctrl+V 粘贴），
 * 再在主进程侧核查「关窗只隐藏、pty 存活、托盘恢复」，最后清理会话并走正常退出路径（before-quit killAll）。
 * 以 JSON 打印到 stdout。生产运行不触发。
 */
import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PtyManager } from './pty/PtyManager'
import type { SessionStore } from './store/SessionStore'

export interface SmokeDeps {
  store: SessionStore
  pty: PtyManager
  quit: () => void
}

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
  window.__smokeOutputs = outputs
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

  // 右键无选区 → 读剪贴板粘贴并执行
  await navigator.clipboard.writeText('echo 右键粘贴OK\\r')
  $('[data-test=terminal-pane] .xterm')?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
  )
  const gotRightClickPaste = await waitFor(() => (outputs[s1.id] ?? '').includes('右键粘贴OK'))

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

  // 唤起区、侧栏收起
  const launchers = $$('[data-test=launch-cmd]').map((b) => b.textContent.trim())
  $('[data-test=tab-side]')?.click()
  await sleep(50)
  const sideHidden = $('.app')?.classList.contains('side-hidden') ?? null
  $('[data-test=tab-side]')?.click()

  return {
    hasProcess: typeof window.process !== 'undefined',
    hasRequire: typeof window.require !== 'undefined',
    hasApi: typeof api === 'object' && api !== null,
    version: await api.app.getVersion(),
    osBuild: await api.app.getOsBuild(),
    shells: await api.app.listShells(),
    statusVersion: $('[data-test=status-version]')?.textContent ?? null,
    sessionIds: [s1.id, s2.id],
    sessionRoundTrip: { before: before.length, rowCountAfterCreate: rowCount, statusAfterCreate: statusSessions },
    terminal: { gotPrompt1, gotEcho, gotRightClickPaste, gotPrompt2, hosts: hosts.length, visibleHosts, hasXterm: !!$('[data-test=terminal-pane] .xterm'), hasCanvas: !!$('[data-test=terminal-pane] canvas'), dataEvents },
    tabs: { tabNames, activeTab, activeAfterSwitch, tabsAfterClose, s2AliveAfterClose, hostsAfterClose },
    strip: { launchers, sideHidden },
  }
})()`

/** 聚焦当前可见终端的输入框，并把一条命令写进剪贴板，供 Ctrl+V 真实按键测试 */
const FOCUS_AND_PREPARE_CLIPBOARD = `(async () => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  host?.querySelector('textarea')?.focus()
  await navigator.clipboard.writeText('echo 快捷键粘贴OK\\r')
  return document.activeElement?.tagName ?? null
})()`

/** 设置弹窗（由主进程广播 app:open-settings 打开）与背景图往返：设图 → 面板出现 data: URL → 清除 */
const SETTINGS_SCRIPT = (pngPath: string): string => `(async () => {
  const api = window.tagterm
  const $ = (sel) => document.querySelector(sel)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (cond, timeoutMs = 5000) => {
    const start = Date.now()
    while (!cond()) {
      if (Date.now() - start > timeoutMs) return false
      await sleep(50)
    }
    return true
  }
  const modalOpened = await waitFor(() => !!$('[data-test=settings-modal]'))
  await waitFor(() => /v[0-9]/.test($('[data-test=about-version]')?.textContent ?? ''))
  const aboutVersion = $('[data-test=about-version]')?.textContent ?? null
  await api.settings.update({ terminalBackground: { imagePath: ${JSON.stringify(pngPath)}, dimOpacity: 0.5 } })
  const bgShown = await waitFor(() => ($('[data-test=terminal-bg]')?.getAttribute('style') ?? '').includes('data:image/png'))
  const dimStyle = $('[data-test=terminal-dim]')?.getAttribute('style') ?? null
  $('[data-test=bg-clear]')?.click()
  const bgCleared = await waitFor(() => !$('[data-test=terminal-bg]'))
  $('[data-test=settings-done]')?.click()
  await sleep(50)
  const modalClosed = !$('[data-test=settings-modal]')
  return { modalOpened, aboutVersion, bgShown, dimStyle, bgCleared, modalClosed }
})()`

/** 1×1 PNG，供背景图往返测试 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 渲染进程脚本卡住时也要退出并留下线索 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms)),
  ])
}

export function runSmokeCheck(win: BrowserWindow, deps: SmokeDeps): void {
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message)
  })
  win.webContents.once('did-finish-load', async () => {
    // 等待 Vue 挂载与 IPC 往返
    await sleep(800)
    let result: Record<string, unknown> = {}
    try {
      result = (await withTimeout(
        win.webContents.executeJavaScript(SMOKE_SCRIPT),
        60000,
        '渲染进程烟测脚本',
      )) as Record<string, unknown>
      const sessionIds = (result['sessionIds'] as string[] | undefined) ?? []
      const pids = sessionIds.map((id) => deps.pty.getPid(id))

      // Ctrl+V 真实按键 → 浏览器原生 paste → xterm 粘贴 → pty 执行
      const focused = (await withTimeout(
        win.webContents.executeJavaScript(FOCUS_AND_PREPARE_CLIPBOARD),
        10000,
        '剪贴板准备',
      )) as string
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] })
      await sleep(600)
      const gotCtrlVPaste = (await win.webContents.executeJavaScript(
        `(window.__smokeOutputs?.[${JSON.stringify(sessionIds[0])}] ?? '').includes('快捷键粘贴OK')`,
      )) as boolean
      const clipboard = { focused, gotCtrlVPaste }

      // 托盘「设置」的广播 → 设置弹窗；背景图设 / 清往返
      const pngPath = join(app.getPath('userData'), 'smoke-bg.png')
      writeFileSync(pngPath, PNG_1X1)
      win.webContents.send('app:open-settings')
      const settings = await withTimeout(
        win.webContents.executeJavaScript(SETTINGS_SCRIPT(pngPath)),
        15000,
        '设置弹窗烟测',
      )

      // 关窗 → 只隐藏；pty 存活；托盘「显示窗口」恢复
      win.close()
      await sleep(300)
      const lifecycle = {
        hiddenAfterClose: !win.isDestroyed() && !win.isVisible(),
        ptyAliveAfterClose: sessionIds.every((id) => deps.pty.has(id)),
        pids,
      }
      win.show()
      await sleep(200)
      Object.assign(lifecycle, { visibleAfterShow: win.isVisible() })

      // 清理烟测会话（正常退出路径由 before-quit killAll 结束 pty）
      for (const id of sessionIds) await deps.store.remove(id)
      const remaining = deps.store.list().length
      console.log(
        '[smoke] ' +
          JSON.stringify({ ...result, clipboard, settings, lifecycle, remaining, consoleErrors }),
      )
    } catch (err) {
      console.log('[smoke] ' + JSON.stringify({ error: String(err), ...result, consoleErrors }))
    }
    deps.quit()
  })
}
