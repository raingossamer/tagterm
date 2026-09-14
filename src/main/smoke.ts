/**
 * 无人值守烟测：设置 TAGTERM_SMOKE=1 启动时，页面加载后核查安全基线与三层贯通
 * （真实会话新建 → 打开两个终端 → 切换 / 关闭标签页 → 中文 echo 往返 → 右键 / Ctrl+V 粘贴 →
 * 标签链路：建标签 / 挂标签 / 分组与副本 / 任一 / 全部 / 搜索 / 路径条胶囊与弹出层 / 删标签 →
 * 右键菜单编辑会话改名 / 移除会话 → 真实 Ctrl+K 聚焦搜索 → 设置弹窗含「启动」段），
 * 再在主进程侧核查「关窗只隐藏、pty 存活、托盘恢复」与 tags.json 落盘，最后清理会话并走正常退出路径（before-quit killAll）。
 * 以 JSON 打印到 stdout。生产运行不触发。
 */
import { app, type BrowserWindow } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PtyManager } from './pty/PtyManager'
import type { SessionStore } from './store/SessionStore'
import type { TagStore } from './store/TagStore'

export interface SmokeDeps {
  store: SessionStore
  tags: TagStore
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

  // 标签链路：两个标签，s1 挂 A、s2 挂 A + B → 左栏 A / B 两组且 s2 出现两次、tooltip 带「同时在」
  const rowOf = (name) => $$('[data-test=session-row]').find((r) => r.textContent.includes(name))
  const rowsOf = (name) => $$('[data-test=session-row]').filter((r) => r.textContent.includes(name))
  const dotsOf = (name) => rowOf(name)?.querySelectorAll('[data-test=row-tag-dot]').length ?? -1
  const groupTitles = () => $$('[data-test=group-title]').map((g) => g.textContent)
  const tagA = await api.tag.create('smoke-标签A')
  const tagB = await api.tag.create('smoke-标签B')
  await api.tag.attach(s1.id, tagA.id)
  await api.tag.attach(s2.id, tagA.id)
  await api.tag.attach(s2.id, tagB.id)
  const gotTagDot = await waitFor(() => dotsOf('smoke-临时') === 1 && rowsOf('smoke-2').length === 2)
  const tagDotColor = rowOf('smoke-临时')?.querySelector('[data-test=row-tag-dot]')?.style.background ?? null
  const groupsTagged = groupTitles()
  const s2Tooltip = rowOf('smoke-2')?.getAttribute('title') ?? null
  // 筛选：点 chip A「任一」→ 只剩 A 组；再选 B 切「全部」→ 单组 A ∩ B 只含 s2；清除后恢复
  const chipOf = (name) => $$('[data-test=tag-chip]').find((c) => c.textContent.includes(name))
  const chipCounts = $$('[data-test=chip-count]').map((c) => c.textContent)
  chipOf('smoke-标签A')?.click()
  await sleep(50)
  const groupsAny = groupTitles()
  chipOf('smoke-标签B')?.click()
  $('[data-test=mode-all]')?.click()
  await sleep(50)
  const groupsAll = groupTitles()
  const rowsAll = $$('[data-test=session-row] .name').map((n) => n.textContent)
  $('[data-test=mode-any]')?.click()
  $('[data-test=filter-clear]')?.click()
  await sleep(50)
  const groupsCleared = groupTitles()
  // 搜索：输入即过滤；无匹配显示整体空态
  const searchInput = $('[data-test=search-input]')
  const setSearch = (v) => { searchInput.value = v; searchInput.dispatchEvent(new Event('input', { bubbles: true })) }
  setSearch('smoke-2')
  await sleep(50)
  const rowsWhenSearching = [...new Set($$('[data-test=session-row] .name').map((n) => n.textContent))]
  setSearch('zzz-no-match')
  await sleep(50)
  const emptyText = $('.groups')?.textContent?.trim() ?? null
  setSearch('')
  await sleep(50)
  // 路径条：选中 s2 → 两个胶囊；点 B 的 × → detach；「+ 标签」弹出层列出全部标签并标 ✓；Esc 关闭
  rowOf('smoke-2')?.click()
  await sleep(100)
  const pillsBefore = $$('[data-test=strip-tag]').map((p) => p.textContent.replace('×', ''))
  $$('[data-test=strip-tag]').find((p) => p.textContent.includes('smoke-标签B'))?.querySelector('[data-test=strip-untag]')?.click()
  const pillRemoved = await waitFor(() => $$('[data-test=strip-tag]').length === 1)
  $('[data-test=strip-add-tag]')?.click()
  await sleep(50)
  const popOptions = $$('[data-test=tag-pop-opt]').map((o) => [o.textContent.replace('✓', ''), !!o.querySelector('[data-test=tag-pop-check]')])
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(50)
  const popClosed = !$('[data-test=tag-pop]')
  rowOf('smoke-临时')?.click()
  await sleep(100)
  // 删标签 → 分组与色点消失
  await api.tag.remove(tagA.id)
  await api.tag.remove(tagB.id)
  const tagDotCleared = await waitFor(() => dotsOf('smoke-临时') === 0 && groupTitles().length === 1)
  const groupsAfterRemove = groupTitles()

  // 右键行 → 菜单 → 编辑会话 → 改名保存（s1 正在运行且空闲，只改名不重启）→ 行名更新、弹窗关闭
  rowOf('smoke-临时')?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 120 }),
  )
  await sleep(50)
  const menuShown = !!$('[data-test=session-menu]')
  $('[data-test=menu-edit]')?.click()
  await sleep(100)
  const editOpened = !!$('[data-test=edit-session-modal]')
  const editName = $('[data-test=es-name]')
  const editPrefilled = editName?.value ?? null
  if (editName) {
    editName.value = 'smoke-已改名'
    editName.dispatchEvent(new Event('input', { bubbles: true }))
  }
  $('[data-test=es-save]')?.click()
  const renamed = await waitFor(() => !!rowOf('smoke-已改名') && !$('[data-test=edit-session-modal]'))
  const s1AliveAfterRename = await api.pty.isAlive(s1.id)
  // 右键 smoke-2 → 菜单「移除会话」（confirm 打桩为同意）：行消失、pty 结束
  window.confirm = () => true
  rowOf('smoke-2')?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 160 }),
  )
  await sleep(50)
  $('[data-test=menu-remove]')?.click()
  const removedByMenu = await waitFor(() => !rowOf('smoke-2'))
  // kill 是同步发出的，但 PtyManager 要等到进程 exit 事件才删条目：轮询到 pty 不再存活
  let s2AliveAfterRemove = true
  for (let i = 0; i < 60 && s2AliveAfterRemove; i++) {
    await sleep(50)
    s2AliveAfterRemove = await api.pty.isAlive(s2.id)
  }
  const rowsAfterRemove = $$('[data-test=session-row]').length

  return {
    hasProcess: typeof window.process !== 'undefined',
    hasRequire: typeof window.require !== 'undefined',
    hasApi: typeof api === 'object' && api !== null,
    version: await api.app.getVersion(),
    osBuild: await api.app.getOsBuild(),
    shells: await api.app.listShells(),
    statusVersion: $('[data-test=status-version]')?.textContent ?? null,
    sessionIds: [s1.id],
    sessionRoundTrip: { before: before.length, rowCountAfterCreate: rowCount, statusAfterCreate: statusSessions },
    edit: { menuShown, editOpened, editPrefilled, renamed, s1AliveAfterRename, removedByMenu, s2AliveAfterRemove, rowsAfterRemove },
    terminal: { gotPrompt1, gotEcho, gotRightClickPaste, gotPrompt2, hosts: hosts.length, visibleHosts, hasXterm: !!$('[data-test=terminal-pane] .xterm'), hasCanvas: !!$('[data-test=terminal-pane] canvas'), dataEvents },
    tabs: { tabNames, activeTab, activeAfterSwitch, tabsAfterClose, s2AliveAfterClose, hostsAfterClose },
    strip: { launchers, sideHidden },
    tags: {
      gotTagDot, tagDotColor, groupsTagged, s2Tooltip, chipCounts, groupsAny, groupsAll, rowsAll, groupsCleared,
      rowsWhenSearching, emptyText, pillsBefore, pillRemoved, popOptions, popClosed, tagDotCleared, groupsAfterRemove,
    },
  }
})()`

/** 聚焦当前可见终端的输入框，并把一条命令写进剪贴板，供 Ctrl+V 真实按键测试 */
const FOCUS_AND_PREPARE_CLIPBOARD = `(async () => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  host?.querySelector('textarea')?.focus()
  await navigator.clipboard.writeText('echo 快捷键粘贴OK\\r')
  return document.activeElement?.tagName ?? null
})()`

/** 聚焦当前可见终端的输入框（Ctrl+K 真实按键测试前） */
const FOCUS_TERMINAL = `(() => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  host?.querySelector('textarea')?.focus()
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
  // 「启动」段：只读状态不改写登录项（开发版恒未勾选；打包版按注册表）
  const autoLaunch = {
    shown: !!$('[data-test=auto-launch]'),
    checked: $('[data-test=auto-launch]')?.checked ?? null,
    blocked: !!$('[data-test=auto-launch-blocked]'),
  }
  await api.settings.update({ terminalBackground: { imagePath: ${JSON.stringify(pngPath)}, dimOpacity: 0.5 } })
  const bgShown = await waitFor(() => ($('[data-test=terminal-bg]')?.getAttribute('style') ?? '').includes('data:image/png'))
  const dimStyle = $('[data-test=terminal-dim]')?.getAttribute('style') ?? null
  $('[data-test=bg-clear]')?.click()
  const bgCleared = await waitFor(() => !$('[data-test=terminal-bg]'))
  // 检查更新：开发模式下 electron-updater 报「未打包」→ error；打包版对着可达的更新源 → none / available
  const updateStatuses = []
  api.update.onStatus((s) => updateStatuses.push(s))
  $('[data-test=update-check]')?.click()
  const updateSettled = await waitFor(() => updateStatuses.some((s) => ['none', 'available', 'error'].includes(s.state)), 15000)
  const updateStatus = updateStatuses[updateStatuses.length - 1] ?? null
  const updateText = $('[data-test=update-status]')?.textContent ?? null
  // 打包版对着托管了更高版本的更新源：点「下载」→ 进度 → downloaded（不点安装，安装留人工验收）
  let download = null
  if (updateStatus?.state === 'available') {
    $('[data-test=update-download]')?.click()
    const downloaded = await waitFor(() => updateStatuses.some((s) => s.state === 'downloaded'), 120000)
    download = {
      downloaded,
      sawProgress: updateStatuses.some((s) => s.state === 'downloading' && s.percent > 0),
      installButton: $('[data-test=update-install]')?.textContent?.trim() ?? null,
    }
  }
  $('[data-test=settings-done]')?.click()
  await sleep(50)
  const modalClosed = !$('[data-test=settings-modal]')
  return { modalOpened, aboutVersion, autoLaunch, bgShown, dimStyle, bgCleared, updateSettled, updateStatus, updateText, download, modalClosed }
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

      // Ctrl+K 真实按键：焦点在 xterm 里也要聚焦搜索框，且 pty 未收到任何字节（输出不增长）
      const outputKey = JSON.stringify(sessionIds[0])
      const outputLenBefore = (await win.webContents.executeJavaScript(
        `(window.__smokeOutputs?.[${outputKey}] ?? '').length`,
      )) as number
      const focusedBeforeCtrlK = (await win.webContents.executeJavaScript(FOCUS_TERMINAL)) as string
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control'] })
      await sleep(400)
      const search = (await win.webContents.executeJavaScript(
        `({ focusedBeforeCtrlK: ${JSON.stringify(focusedBeforeCtrlK)}, focusedAfterCtrlK: document.activeElement?.getAttribute('data-test') ?? document.activeElement?.tagName ?? null, outputGrew: (window.__smokeOutputs?.[${outputKey}] ?? '').length > ${outputLenBefore} })`,
      )) as Record<string, unknown>

      // 托盘「设置」的广播 → 设置弹窗；背景图设 / 清往返
      const pngPath = join(app.getPath('userData'), 'smoke-bg.png')
      writeFileSync(pngPath, PNG_1X1)
      win.webContents.send('app:open-settings')
      const settings = await withTimeout(
        win.webContents.executeJavaScript(SETTINGS_SCRIPT(pngPath)),
        180000,
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

      // 清理烟测会话（正常退出路径由 before-quit killAll 结束 pty）；tags.json 应已落盘且只剩空集合
      for (const id of sessionIds) await deps.store.remove(id)
      const remaining = deps.store.list().length
      const tagsFile = {
        exists: existsSync(join(app.getPath('userData'), 'tags.json')),
        remaining: deps.tags.list(),
      }
      console.log(
        '[smoke] ' +
          JSON.stringify({
            ...result,
            clipboard,
            search,
            settings,
            lifecycle,
            remaining,
            tagsFile,
            consoleErrors,
          }),
      )
    } catch (err) {
      console.log('[smoke] ' + JSON.stringify({ error: String(err), ...result, consoleErrors }))
    }
    deps.quit()
  })
}
