/**
 * 无人值守烟测：设置 TAGTERM_SMOKE=1 启动时，页面加载后核查安全基线与三层贯通
 * （真实会话新建 → 打开两个终端 → 切换 / 关闭标签页 → 中文 echo 往返 → 右键 / Ctrl+V 粘贴 →
 * 标签链路：建标签 / 挂标签 / 分组与副本 / 任一 / 全部 / 搜索 / 路径条胶囊与弹出层 / 删标签 →
 * 右键菜单编辑会话改名 / 移除会话 → 真实 Ctrl+K 聚焦搜索 → 设置弹窗四段导航与全局背景往返），
 * 再在主进程侧核查「关窗只隐藏、pty 存活、托盘恢复」、「结束 pty 后整页重载 → 标签页与当前页恢复、只有当前页重新 spawn」
 * 与 tags.json 落盘，最后清理会话并走正常退出路径（before-quit killAll）。
 * 以 JSON 打印到 stdout。生产运行不触发。
 */
import { app, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import type { PtyManager } from './pty/PtyManager'
import type { AgentSubsystem, BadgeCounts } from './agent/AgentSubsystem'
import type { SessionStore } from './store/SessionStore'
import type { TagStore } from './store/TagStore'

export interface SmokeDeps {
  store: SessionStore
  tags: TagStore
  pty: PtyManager
  /** agent 子系统：hooks 端口、运行时记录、shell 空闲核对（核查与诊断用） */
  agent: AgentSubsystem
  /** 托盘当前的角标计数（等你确认 / 运行中）；托盘还没建为 null */
  badgeCounts: () => BadgeCounts | null
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

  // 上一轮烟测中途出错会留下 smoke-* 会话（清理在最后）：先清掉，否则行序错位、后面的断言全偏
  for (const s of await api.session.list()) if (s.name.startsWith('smoke-')) await api.session.remove(s.id)
  await sleep(100)
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

  // cwd 追踪：在真实 cmd 里 cd 到别的目录 → 静默 1.5 s 后渲染进程上报末尾几行 → 主进程解析提示符 → 路径条跟着变，tooltip 第二行仍是固定目录
  const stripPathBefore = $('[data-test=strip-path]')?.textContent ?? null
  api.pty.write(s1.id, 'cd C:\\\\Windows\\r')
  const cwdTracked = await waitFor(() => $('[data-test=strip-path]')?.textContent === 'C:\\\\Windows')
  const stripPathAfter = $('[data-test=strip-path]')?.textContent ?? null
  const stripTitleAfter = $('[data-test=strip-path]')?.getAttribute('title') ?? null
  const cwdNowInRuntime = (await api.agent.list()).find((r) => r.sessionId === s1.id)?.cwdNow ?? null
  const cwdTrack = { stripPathBefore, cwdTracked, stripPathAfter, stripTitleAfter, cwdNowInRuntime }

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

  // agent 运行时记录：两个终端开着（s1 在跑、s2 关了标签页但 pty 还在）→ 两条 alive 记录、全部 idle；状态点与状态栏计数都是空闲
  const agentList = await api.agent.list()
  const agentRuntime = {
    aliveIds: agentList.filter((r) => r.alive).map((r) => r.sessionId).sort(),
    expectedIds: [s1.id, s2.id].sort(),
    allIdle: agentList.every((r) => r.status === 'idle' && r.agent === null),
    rowDotIdle: $$('[data-test=session-row] .dot').every((d) => d.classList.contains('idle')),
    tabDotIdle: $$('[data-test=tab] .dot').every((d) => d.classList.contains('idle')),
    counts: ['working', 'blocked', 'done'].map((k) => $('[data-test=status-' + k + ']')?.textContent.trim()),
  }

  // 终端右侧滚动条：滑块透明（用户要求取消，滑轮照常）。xterm 是 VS Code 式自绘滚动条
  const sliderEl = $('[data-test=terminal-pane] .xterm-scrollable-element > .scrollbar > .slider')
  const sliderBg = sliderEl ? getComputedStyle(sliderEl).backgroundColor : null
  const sliderHidden = sliderBg === 'rgba(0, 0, 0, 0)' || sliderBg === 'transparent'

  // 唤起区、侧栏收起
  const launchers = $$('[data-test=launch-cmd]').map((b) => b.textContent.trim())
  $('[data-test=tab-side]')?.click()
  await sleep(50)
  const sideHidden = $('.app')?.classList.contains('side-hidden') ?? null
  $('[data-test=tab-side]')?.click()

  // 标签链路：两个标签，s1 挂 A、s2 挂 A + B → 左栏 A / B 两组且 s2 出现两次、tooltip 带「同时在」
  const rowOf = (name) => $$('[data-test=session-row]').find((r) => r.textContent.includes(name))
  const rowsOf = (name) => $$('[data-test=session-row]').filter((r) => r.textContent.includes(name))
  const groupTitles = () => $$('[data-test=group-title]').map((g) => g.textContent)
  // 某会话出现在哪些分组下（行上不再画标签色点，挂了哪些标签看它落在哪些组）
  const groupsOf = (name) => $$('[data-test=group]')
    .filter((g) => [...g.querySelectorAll('[data-test=session-row]')].some((r) => r.textContent.includes(name)))
    .map((g) => g.querySelector('[data-test=group-title]')?.textContent ?? null)
  const tagA = await api.tag.create('smoke-标签A')
  const tagB = await api.tag.create('smoke-标签B')
  await api.tag.attach(s1.id, tagA.id)
  await api.tag.attach(s2.id, tagA.id)
  await api.tag.attach(s2.id, tagB.id)
  const gotTagged = await waitFor(() => groupsOf('smoke-临时').includes('smoke-标签A') && rowsOf('smoke-2').length === 2)
  const s1Groups = groupsOf('smoke-临时')
  // 会话名与所在分组头的标签名左缘对齐（2026-09-21 用户选定「文字对文字」，色点那一列留空）：有色点的组与「未打标签」组都要对上
  const nameAligned = (name) => {
    const row = rowOf(name)
    const nameEl = row?.querySelector('.name')
    const title = row?.closest('[data-test=group]')?.querySelector('[data-test=group-title]')
    if (!nameEl || !title) return null
    return Math.abs(nameEl.getBoundingClientRect().left - title.getBoundingClientRect().left) <= 1
  }
  const nameAlignedTagged = nameAligned('smoke-临时')
  // 行布局（2026-09-21）：行上没有标签色点，状态点是行的最后一个子元素（右侧）
  const rowTagDots = $$('[data-test=row-tag-dot]').length
  const statusDotLast = rowOf('smoke-临时')?.lastElementChild?.classList.contains('dot') ?? null
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
  // 「复制」悬停露出「打开」（纯前端，2026-09-21）：只看露出与对齐，不点它 —— 点了烟测会真的弹出资源管理器窗口
  const copyWrap = $('[data-test=strip-copy-wrap]')
  const openHiddenBefore = !$('[data-test=strip-open]')
  copyWrap?.dispatchEvent(new MouseEvent('mouseenter'))
  await sleep(50)
  const openShown = !!$('[data-test=strip-open]')
  const popRect = $('[data-test=strip-copy-pop]')?.getBoundingClientRect()
  const copyRect = $('[data-test=strip-copy]')?.getBoundingClientRect()
  const openAligned = !!popRect && !!copyRect
    && Math.abs(popRect.left - copyRect.left) <= 1 && popRect.top >= copyRect.bottom - 1
  copyWrap?.dispatchEvent(new MouseEvent('mouseleave'))
  await sleep(50)
  const openHiddenAfter = !$('[data-test=strip-open]')
  const copyHover = { openHiddenBefore, openShown, openAligned, openHiddenAfter }
  rowOf('smoke-临时')?.click()
  await sleep(100)

  // 标签管理：拖拽排序 → 左栏分组与筛选胶囊顺序跟着变
  const chipTitles = () => $$('[data-test=tag-chip]').map((c) => c.textContent.replace(/[0-9]+$/, '').trim())
  const groupsBeforeReorder = groupTitles()
  await api.tag.reorder([tagB.id, tagA.id])
  const reorderApplied = await waitFor(() => groupTitles()[0] === 'smoke-标签B')
  const groupsAfterReorder = groupTitles()
  const chipsAfterReorder = chipTitles()
  // 还原顺序，避免影响后续断言
  await api.tag.reorder([tagA.id, tagB.id])
  await waitFor(() => groupTitles()[0] === 'smoke-标签A')

  // 会话组内拖拽排序：组内第二行拖到第一行 → 两行互换（槽位置换，全局顺序跟着变）
  const rowNames = () => $$('[data-test=session-row]').map((r) => r.querySelector('.name')?.textContent)
  const orderedIds = async () => (await api.session.list()).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id)
  const idsBeforeDrag = await orderedIds()
  const namesBeforeDrag = rowNames()
  const dragRows = $$('[data-test=session-row]')
  dragRows[1]?.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
  dragRows[0]?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }))
  const dragApplied = await waitFor(() => rowNames()[0] === namesBeforeDrag[1])
  const namesAfterDrag = rowNames()
  const globalOrderChanged = (await orderedIds()).join() !== idsBeforeDrag.join()
  await api.session.reorder(idsBeforeDrag) // 还原，避免影响后续断言
  await waitFor(() => rowNames()[0] === namesBeforeDrag[0])

  // 启用 / 禁用左栏展示：隐藏标签 = 把这一组会话整体从左栏收起来（不是落到「未打标签」），会话本身不丢。
  // 此刻 smoke-临时 与 smoke-2 都只挂着 A（B 已在路径条那步摘掉）
  await api.tag.update(tagA.id, { hidden: true })
  const hiddenApplied = await waitFor(
    () => !groupTitles().includes('smoke-标签A') && !chipTitles().includes('smoke-标签A'),
  )
  const rowsWhenAHidden = $$('[data-test=session-row]').length // 两个会话都收起来 → 0 行
  const untaggedWhenAHidden = groupTitles().includes('未打标签') // 不该落到「未打标签」
  setSearch('smoke-临时')
  await sleep(120)
  const searchFindsHidden = $$('[data-test=session-row]').length > 0 // 搜索也搜不到
  setSearch('')
  await sleep(120)
  const sessionsKeptWhenHidden = (await api.session.list()).length // 会话没丢
  // 混合标签：给 smoke-临时 再挂上未隐藏的 B → 它回到 B 组显示
  await api.tag.attach(s1.id, tagB.id)
  const mixedShown = await waitFor(() => !!rowOf('smoke-临时'))
  const groupsWhenMixed = groupTitles()
  await api.tag.detach(s1.id, tagB.id)
  await waitFor(() => !rowOf('smoke-临时'))
  await api.tag.update(tagA.id, { hidden: false })
  const shownAgain = await waitFor(() => groupTitles().includes('smoke-标签A') && !!rowOf('smoke-临时'))

  // 删标签 → 分组消失，会话回到唯一的「未打标签」组
  await api.tag.remove(tagA.id)
  await api.tag.remove(tagB.id)
  const tagsCleared = await waitFor(() => groupTitles().length === 1 && groupsOf('smoke-临时').length === 1)
  const nameAlignedUntagged = nameAligned('smoke-临时')
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
    scrollbar: { sliderBg, sliderHidden },
    agentRuntime,
    cwdTrack,
    sessionDrag: { namesBeforeDrag, dragApplied, namesAfterDrag, globalOrderChanged },
    tags: {
      gotTagged, s1Groups, rowTagDots, statusDotLast, nameAlignedTagged, nameAlignedUntagged, groupsTagged, s2Tooltip, chipCounts, groupsAny, groupsAll, rowsAll, groupsCleared,
      rowsWhenSearching, emptyText, pillsBefore, pillRemoved, popOptions, popClosed, copyHover, tagsCleared, groupsAfterRemove,
      groupsBeforeReorder, reorderApplied, groupsAfterReorder, chipsAfterReorder,
      hiddenApplied, rowsWhenAHidden, untaggedWhenAHidden, searchFindsHidden, sessionsKeptWhenHidden,
      mixedShown, groupsWhenMixed, shownAgain,
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

/** 当前可见终端 host 的中心点（视口坐标），供真实右键点击 */
const TERMINAL_CENTER = `(() => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  const r = host?.getBoundingClientRect()
  return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null
})()`

/** 左栏塞进 25 个会话（不开终端）：.side 不得高过窗口、列表区 .groups 自己滚动、底部按钮条在窗口内；测完全部移除 */
const SIDEBAR_SCRIPT = `(async () => {
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
  const created = []
  for (let i = 0; i < 25; i++) created.push(await api.session.create({ name: 'smoke-fill-' + i, cwd: 'C:\\\\Windows' }))
  const filled = await waitFor(() => $$('[data-test=session-row]').length >= 25)
  const side = $('.side').getBoundingClientRect()
  const foot = $('.side-foot').getBoundingClientRect()
  const groups = $('.groups')
  const result = {
    filled,
    innerHeight,
    sideBottom: Math.round(side.bottom),
    footBottom: Math.round(foot.bottom),
    sideFits: side.bottom <= innerHeight + 1,
    footVisible: foot.top >= 0 && foot.bottom <= innerHeight + 1,
    listScrolls: groups.scrollHeight > groups.clientHeight + 1,
  }
  for (const s of created) await api.session.remove(s.id)
  await waitFor(() => !$$('[data-test=session-row]').some((r) => r.textContent.includes('smoke-fill-')))
  return result
})()`

/**
 * 终端区里的东西伸出右缘（输入法组合串靠近右缘时 xterm 的 composition-view / textarea 就是这样）：整窗不得被挤走。
 * 先把 .term-wrap 的 overflow 临时改成 visible 证明探针确实能把视口滚走（对照组），再按样式表原样量一次：视口不动
 */
const TERMINAL_OVERFLOW_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const pane = document.querySelector('[data-test=terminal-pane]')
  const wrap = document.querySelector('.term-wrap')
  if (!pane || !wrap) return { pane: !!pane, wrap: !!wrap }
  const probe = document.createElement('textarea')
  probe.style.cssText = 'position:absolute;left:' + (innerWidth + 200) + 'px;top:10px;width:300px;height:20px'
  pane.appendChild(probe)
  const measure = async () => {
    probe.focus()
    probe.scrollIntoView({ inline: 'end', block: 'nearest' })
    await sleep(100)
    const shift = Math.max(Math.round(scrollX), Math.round(document.scrollingElement?.scrollLeft ?? 0), -Math.round(document.querySelector('.app').getBoundingClientRect().left))
    scrollTo(0, 0)
    return shift
  }
  wrap.style.overflow = 'visible'
  const shiftWithoutClip = await measure()
  wrap.style.overflow = ''
  const shiftWithClip = await measure()
  probe.remove()
  return { overflow: getComputedStyle(wrap).overflow, shiftWithoutClip, shiftWithClip, probeWorks: shiftWithoutClip > 0, stayedPut: shiftWithClip === 0 }
})()`

/** 聚焦当前可见终端的输入框（Ctrl+K 真实按键测试前） */
const FOCUS_TERMINAL = `(() => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  host?.querySelector('textarea')?.focus()
  return document.activeElement?.tagName ?? null
})()`

/** 设置弹窗（由左栏齿轮打开）：四段导航 + 全局背景往返（设图 → 背景层出现 → 移除）+ 检查更新 */
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
  // 四段导航：缺省停在外观；切到启动段只读核查登录项状态（不改写注册表）
  const navLabels = [...document.querySelectorAll('[data-test^=settings-nav-]')].map((b) => b.textContent.trim())
  const appearanceShown = !!$('[data-test=appearance-section]')
  $('[data-test=settings-nav-startup]')?.click()
  await sleep(50)
  const autoLaunch = {
    shown: !!$('[data-test=auto-launch]'),
    checked: $('[data-test=auto-launch]')?.checked ?? null,
    blocked: !!$('[data-test=auto-launch-blocked]'),
    instant: !!$('[data-test=auto-launch-instant]'),
  }
  // Agent 段：只读核查两个开关与端口（不切开关 —— 那会改用户真实的 hooks 配置文件）
  $('[data-test=settings-nav-agent]')?.click()
  await sleep(50)
  const hooksSection = {
    shown: !!$('[data-test=agent-section]'),
    claudeBox: !!$('[data-test=hooks-claude]'),
    codexBox: !!$('[data-test=hooks-codex]'),
    statuses: [$('[data-test=hooks-claude-status]')?.textContent, $('[data-test=hooks-codex-status]')?.textContent],
    port: $('[data-test=hooks-port]')?.textContent ?? null,
    instant: !!$('[data-test=hooks-instant]'),
  }
  $('[data-test=settings-nav-about]')?.click()
  await waitFor(() => /v[0-9]/.test($('[data-test=about-version]')?.textContent ?? ''))
  const aboutVersion = $('[data-test=about-version]')?.textContent ?? null
  // 全局背景往返：主进程写入一张图（代替文件对话框）→ 背景层出现并带模糊 → 面板不透明度写在根元素上且面板计算底色真的半透明
  //   → 重开弹窗让草稿拿到这张图 → 「移除背景」只预览：整层消失 → 「取消」还原 → 主进程清掉图片：整层消失、面板恢复不透明
  $('[data-test=settings-nav-appearance]')?.click()
  await sleep(50)
  await api.settings.update({ background: { imagePath: ${JSON.stringify(pngPath)}, fit: 'cover', imageOpacity: 0.3, panelOpacity: 0.8, blurPx: 6 } })
  const bgShown = await waitFor(() => ($('[data-test=app-background]')?.getAttribute('style') ?? '').includes('data:image/png'))
  const bgStyle = $('[data-test=app-background]')?.getAttribute('style') ?? null
  const panelOpacity = document.documentElement.style.getPropertyValue('--panel-opacity') || null
  // 变量值对还不够，面板的计算底色必须真的带 alpha：0.2.4 把变量写在 .app 上，变量是 0.8、面板却仍不透明
  const alphaOf = (el) => {
    const c = el ? getComputedStyle(el).backgroundColor : ''
    const m = /\\/\\s*([\\d.]+)\\)$/.exec(c) ?? /^rgba\\([^,]+,[^,]+,[^,]+,\\s*([\\d.]+)\\)$/.exec(c)
    return m ? Number(m[1]) : 1
  }
  const panelBg = { side: $('.side') ? getComputedStyle($('.side')).backgroundColor : null, term: $('.term-wrap') ? getComputedStyle($('.term-wrap')).backgroundColor : null }
  const panelsTranslucent = alphaOf($('.side')) < 1 && alphaOf($('.term-wrap')) < 1
  // 弹窗的草稿是打开时抓的快照，不跟广播走：关掉再从左栏齿轮重开，草稿才拿到这张图、「移除背景」才可点
  $('[data-test=settings-cancel]')?.click()
  await sleep(50)
  $('[data-test=open-settings]')?.click()
  await sleep(50)
  const gearOpened = !!$('[data-test=settings-modal]')
  const thumbShown = await waitFor(() => !!$('[data-test=bg-thumb] img'))
  const bgName = $('[data-test=bg-name]')?.textContent?.trim() ?? null
  $('[data-test=bg-clear]')?.click()
  const bgCleared = await waitFor(() => !$('[data-test=app-background]'))
  $('[data-test=settings-cancel]')?.click()
  const bgRestored = await waitFor(() => !!$('[data-test=app-background]'))
  await api.settings.update({ background: { imagePath: null, fit: 'contain', imageOpacity: 0.35, panelOpacity: 0.75, blurPx: 4 } })
  const bgRemoved = await waitFor(() => !$('[data-test=app-background]'))
  const panelOpacityCleared = document.documentElement.style.getPropertyValue('--panel-opacity') || null
  $('[data-test=open-settings]')?.click()
  await sleep(50)
  $('[data-test=settings-nav-update]')?.click()
  await sleep(50)
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
  $('[data-test=settings-cancel]')?.click()
  await sleep(50)
  const modalClosed = !$('[data-test=settings-modal]')
  return { modalOpened, gearOpened, navLabels, appearanceShown, aboutVersion, autoLaunch, hooksSection, bgShown, bgStyle, panelOpacity, panelBg, panelsTranslucent, thumbShown, bgName, bgCleared, bgRestored, bgRemoved, panelOpacityCleared, updateSettled, updateStatus, updateText, download, modalClosed }
})()`

/** 恢复标签页准备：再开两个会话并打开终端，把当前页放中间（标签页 [s1, r3, r4]，当前页 r3）；返回 id 与 localStorage 记下的内容 */
const RESTORE_PREPARE_SCRIPT = `(async () => {
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
  const rowOf = (name) => $$('[data-test=session-row]').find((r) => r.textContent.includes(name))
  const tabNames = () => $$('[data-test=tab-name]').map((t) => t.textContent)
  const activeTab = () => $('[data-test=tab].active [data-test=tab-name]')?.textContent ?? null
  const r3 = await api.session.create({ cwd: 'C:\\\\Windows', name: 'smoke-r3' })
  const r4 = await api.session.create({ cwd: 'C:\\\\Windows\\\\System32', name: 'smoke-r4' }) // 与 r3 目录不同：hooks 按 cwd 映射时不歧义
  await waitFor(() => !!rowOf('smoke-r4'))
  rowOf('smoke-r3')?.click()
  await waitFor(() => activeTab() === 'smoke-r3')
  rowOf('smoke-r4')?.click()
  await waitFor(() => activeTab() === 'smoke-r4')
  $$('[data-test=tab]').find((t) => t.textContent.includes('smoke-r3'))?.click()
  const prepared = await waitFor(() => activeTab() === 'smoke-r3')
  await sleep(300)
  return { ids: [r3.id, r4.id], prepared, tabsBefore: tabNames(), activeBefore: activeTab(), stored: localStorage.getItem('tagterm.openTabs') }
})()`

/** 整页重载后：等标签页恢复，返回标签页、当前页与终端是否就位 */
const RESTORE_CHECK_SCRIPT = `(async () => {
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
  const restored = await waitFor(() => $$('[data-test=tab]').length >= 3 && !!$('[data-test=tab].active'))
  await sleep(500)
  return {
    restored,
    tabsAfter: $$('[data-test=tab-name]').map((t) => t.textContent),
    activeAfter: $('[data-test=tab].active [data-test=tab-name]')?.textContent ?? null,
    hostsAfter: ($('[data-test=terminal-pane]')?.children ?? []).length,
  }
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

/** 像 hooks 里的 curl 那样把 JSON POST 到本地 HookServer；返回状态码 */
function postHook(port: number, agent: 'claude' | 'codex', payload: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: `/tagterm/hook/${agent}`, method: 'POST' },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify(payload))
  })
}

/** 渲染进程里某会话行的状态点类名与 tooltip、标签页 tooltip、状态栏三项计数 */
const ROW_STATE = (name: string): string => `(() => {
  const row = [...document.querySelectorAll('[data-test=session-row]')].find((r) => r.textContent.includes(${JSON.stringify(name)}))
  const tab = [...document.querySelectorAll('[data-test=tab]')].find((t) => t.textContent.includes(${JSON.stringify(name)}))
  const dot = row?.querySelector('.dot')
  return {
    dot: dot ? [...dot.classList].filter((c) => c !== 'dot')[0] ?? null : null,
    rowTitle: row?.getAttribute('title') ?? null,
    tabTitle: tab?.getAttribute('title') ?? null,
    counts: ['working', 'blocked', 'done'].map((k) => document.querySelector('[data-test=status-' + k + ']')?.textContent.trim()),
  }
})()`

export function runSmokeCheck(win: BrowserWindow, deps: SmokeDeps): void {
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message)
  })
  win.webContents.once('did-finish-load', async () => {
    // 先把窗口抢到前台：渲染脚本一开头就用 navigator.clipboard，而它要求文档有焦点 ——
    // 启动瞬间焦点还在别的窗口上时会抛一个非 Error 对象，整轮烟测只剩 error: [object Object]
    win.show()
    win.focus()
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

      // 进程树（原生模块在开发版 Electron 内加载成功的证据）：空闲 cmd 无子进程 → 跑 ping 期间有 → 跑完又没有
      const shellPid = pids[0] ?? 0
      const pollChildren = async (expected: boolean, timeoutMs: number): Promise<boolean> => {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
          if (!(await deps.agent.isShellIdle(shellPid)) === expected) return true
          await sleep(100)
        }
        return false
      }
      const idleBefore = await pollChildren(false, 3000)
      deps.pty.write(sessionIds[0]!, 'ping -n 2 127.0.0.1\r')
      const busyDuringPing = await pollChildren(true, 3000)
      const idleAfterPing = await pollChildren(false, 8000)
      const processTree = { shellPid, idleBefore, busyDuringPing, idleAfterPing }

      // Ctrl+V 真实按键 → 浏览器原生 paste → xterm 粘贴 → pty 执行。
      // 先把窗口抢回前台：navigator.clipboard 要求文档聚焦，渲染脚本跑了几十秒期间桌面上别的东西可能拿走了焦点
      win.show()
      win.focus()
      await sleep(200)
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

      // 右键真实点击（mouseDown / mouseUp button=right，Chromium 自己派发 contextmenu）：无选区时读剪贴板粘贴，且只粘一次；
      // 上面的合成 contextmenu 事件只经过我们的监听器，量不出真实点击会不会被粘两遍
      const termCenter = (await win.webContents.executeJavaScript(TERMINAL_CENTER)) as {
        x: number
        y: number
      } | null
      let rightClick: Record<string, unknown> = { termCenter }
      if (termCenter) {
        await win.webContents.executeJavaScript(
          `navigator.clipboard.writeText('echo 右键真实粘贴OK')`,
        )
        const lenBefore = (await win.webContents.executeJavaScript(
          `(window.__smokeOutputs?.[${outputKey}] ?? '').length`,
        )) as number
        const mouse = { x: termCenter.x, y: termCenter.y, button: 'right' as const, clickCount: 1 }
        win.webContents.sendInputEvent({ type: 'mouseDown', ...mouse })
        win.webContents.sendInputEvent({ type: 'mouseUp', ...mouse })
        await sleep(800)
        const pasteCount = (await win.webContents.executeJavaScript(
          `(window.__smokeOutputs?.[${outputKey}] ?? '').slice(${lenBefore}).split('右键真实粘贴OK').length - 1`,
        )) as number
        deps.pty.write(sessionIds[0]!, '\r') // 把粘进去的那行执行掉，别留在提示符上
        await sleep(300)
        rightClick = { termCenter, pasteCount }
      }

      // 托盘「设置」的广播 → 设置弹窗；背景图设 / 清往返
      const pngPath = join(app.getPath('userData'), 'smoke-bg.png')
      writeFileSync(pngPath, PNG_1X1)
      win.webContents.send('app:open-settings')
      const settings = await withTimeout(
        win.webContents.executeJavaScript(SETTINGS_SCRIPT(pngPath)),
        180000,
        '设置弹窗烟测',
      )

      // 左栏塞满会话：列表区自己滚动，底部按钮条钉在窗口内
      const sidebar = await withTimeout(
        win.webContents.executeJavaScript(SIDEBAR_SCRIPT),
        60000,
        '左栏溢出烟测',
      )

      // 终端区溢出：伸出右缘的元素被聚焦 / scrollIntoView 时整窗不得被挤走（带对照组）
      const termOverflow = await withTimeout(
        win.webContents.executeJavaScript(TERMINAL_OVERFLOW_SCRIPT),
        10000,
        '终端区溢出烟测',
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

      // 恢复标签页：再开两个会话把当前页放中间 → 结束三条 pty（模拟退出）→ 整页重载（模拟重开）
      //   → 标签页顺序与当前页照旧，pty 只有当前页那一条重新 spawn，其余标签页点到才起
      const prepare = (await withTimeout(
        win.webContents.executeJavaScript(RESTORE_PREPARE_SCRIPT),
        30000,
        '恢复标签页准备',
      )) as { ids: string[] } & Record<string, unknown>
      const restoreIds = [sessionIds[0]!, ...prepare.ids]
      for (const id of restoreIds) await deps.pty.killAndWait(id)
      const aliveBeforeReload = restoreIds.filter((id) => deps.pty.has(id)).length
      const reloaded = new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
      win.webContents.reload()
      await reloaded
      await sleep(800)
      const check = (await withTimeout(
        win.webContents.executeJavaScript(RESTORE_CHECK_SCRIPT),
        30000,
        '恢复标签页核查',
      )) as Record<string, unknown>
      const aliveAfterReload = restoreIds.filter((id) => deps.pty.has(id))
      const restore = {
        ...prepare,
        ...check,
        aliveBeforeReload,
        aliveAfterReload: aliveAfterReload.length,
        onlyActiveSpawned: aliveAfterReload.length === 1 && aliveAfterReload[0] === prepare.ids[0],
      }
      sessionIds.push(...prepare.ids)

      // hooks 转移：此刻标签页 [s1, r3, r4]、当前页 r3（已 spawn）。先点开 r4（spawn 并成为「正被查看」），
      // 再像 Claude Code 的 hook 那样把 stdin JSON POST 到本地端点：r3（cwd C:\Windows）SessionStart → UserPromptSubmit → working
      // → Notification(permission_prompt) → blocked（行 / 标签页 tooltip 带提示、状态栏计数）→ Stop（没人看）→ done → 点回 r3 → idle；
      // 再对 r4（cwd C:\Windows\System32）走 Codex 路径：PermissionRequest → blocked（tooltip 带 tool_input.description）→ Interrupt → idle
      const rowState = (name: string): Promise<Record<string, unknown>> =>
        win.webContents.executeJavaScript(ROW_STATE(name)) as Promise<Record<string, unknown>>
      const waitDot = async (name: string, expected: string): Promise<boolean> => {
        const start = Date.now()
        while (Date.now() - start < 5000) {
          if ((await rowState(name))['dot'] === expected) return true
          await sleep(100)
        }
        return false
      }
      const clickTab = async (name: string): Promise<void> => {
        win.focus() // 「正被查看」要求窗口聚焦
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('[data-test=tab]')].find((t) => t.textContent.includes(${JSON.stringify(name)}))?.click()`,
        )
        await sleep(300)
      }
      await clickTab('smoke-r4')
      // r4 刚 spawn：进程树探针 2 s 一轮，它被 watch 后的首轮快照会把整张表回调一次；若那一拍落在 hooks 已声明 agent 之后，
      // 「agent 以进程树为准」会把 r4 的 agent 清回 null，后面的 PermissionRequest 就因无 agent 被忽略（实测偶发）。等过这一轮再发 hooks
      await sleep(2200)
      const claudeCwd = 'C:/Windows'
      const statuses: number[] = []
      const send = async (
        agent: 'claude' | 'codex',
        payload: Record<string, unknown>,
      ): Promise<void> => {
        statuses.push(await postHook(deps.agent.port, agent, payload))
      }
      await send('claude', { hook_event_name: 'SessionStart', cwd: claudeCwd, session_id: 'smoke' })
      await send('claude', { hook_event_name: 'UserPromptSubmit', cwd: claudeCwd })
      const claudeWorking = await waitDot('smoke-r3', 'working')
      await send('claude', {
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'Allow smoke tool?',
        cwd: claudeCwd,
      })
      const claudeBlocked = await waitDot('smoke-r3', 'blocked')
      const blockedState = await rowState('smoke-r3')
      const badgeWhenBlocked = deps.badgeCounts()
      await send('claude', { hook_event_name: 'Stop', cwd: claudeCwd })
      const claudeDone = await waitDot('smoke-r3', 'done')
      const doneState = await rowState('smoke-r3')
      await clickTab('smoke-r3')
      const claudeIdleAfterView = await waitDot('smoke-r3', 'idle')
      // 诊断：done → idle 靠「正被查看」，而它要求窗口有焦点且可见
      const viewDiag = (await win.webContents.executeJavaScript(
        `({ hasFocus: document.hasFocus(), hidden: document.hidden, active: document.querySelector('[data-test=tab].active [data-test=tab-name]')?.textContent ?? null })`,
      )) as Record<string, unknown>
      Object.assign(viewDiag, {
        winFocused: win.isFocused(),
        winVisible: win.isVisible(),
        r3Status: deps.agent.list().find((r) => r.sessionId === prepare.ids[0])?.status ?? null,
      })

      const codexCwd = 'C:/Windows/System32'
      await send('codex', { hook_event_name: 'SessionStart', cwd: codexCwd })
      await send('codex', { hook_event_name: 'UserPromptSubmit', cwd: codexCwd })
      await send('codex', {
        hook_event_name: 'PermissionRequest',
        tool_name: 'shell',
        tool_input: { description: 'run dir' },
        cwd: codexCwd,
      })
      const codexBlocked = await waitDot('smoke-r4', 'blocked')
      const codexBlockedState = await rowState('smoke-r4')
      await send('codex', { hook_event_name: 'Interrupt', cwd: codexCwd })
      const codexIdle = await waitDot('smoke-r4', 'idle')
      const badgeWhenIdle = deps.badgeCounts()
      // 通知点击的落地路径：主进程广播 app:select-session → 渲染进程切到该会话（toast 本身留人工验收）
      win.webContents.send('app:select-session', prepare.ids[1]!)
      await sleep(300)
      const selectedByBroadcast = (await win.webContents.executeJavaScript(
        `document.querySelector('[data-test=tab].active [data-test=tab-name]')?.textContent ?? null`,
      )) as string | null
      const badJson = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: deps.agent.port,
            path: '/tagterm/hook/claude',
            method: 'POST',
          },
          (res) => {
            res.resume()
            res.on('end', () => resolve(res.statusCode ?? 0))
          },
        )
        req.on('error', reject)
        req.end('{ not json')
      })
      const hooks = {
        port: deps.agent.port,
        statuses,
        badJson,
        claudeWorking,
        claudeBlocked,
        blockedRowTitle: blockedState['rowTitle'],
        blockedTabTitle: blockedState['tabTitle'],
        blockedCounts: blockedState['counts'],
        claudeDone,
        doneCounts: doneState['counts'],
        claudeIdleAfterView,
        viewDiag,
        codexBlocked,
        codexRowTitle: codexBlockedState['rowTitle'],
        codexIdle,
        badgeWhenBlocked,
        badgeWhenIdle,
        selectedByBroadcast,
      }

      // 没装 hooks 时的「运行中」判定走真实链路核查（0.3.1 的回归就出在这里，单测的合成屏幕守不住装配）：
      //   把 ping.exe 复制成 claude.exe 在 s1 里跑起来 → 进程树认出 agent（s1 从未收到 hook，不在抑制窗里）
      //   → 经真实 IPC 送两份计时器递增的屏幕 → 运行中；送一份只是「提到提示文案」的屏幕 → 不得转移；
      //   送两份重试横幅倒数递减的屏幕 → 等你确认（只是引用横幅的静态两份不得转移），横幅消失计时器再走 → 回运行中；
      //   送跑完的屏幕（耗时不在括号里）→ 离开运行中；Ctrl+C 停掉假 agent → 回空闲
      const fakeAgentExe = join(app.getPath('userData'), 'claude.exe')
      let heuristic: Record<string, unknown> = {}
      try {
        copyFileSync(
          join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'ping.exe'),
          fakeAgentExe,
        )
        const s1 = sessionIds[0]!
        const statusOf = (): string | null =>
          deps.agent.list().find((r) => r.sessionId === s1)?.status ?? null
        const agentOf = (): string | null =>
          deps.agent.list().find((r) => r.sessionId === s1)?.agent ?? null
        const report = (tail: string[], silentMs: number): Promise<unknown> =>
          win.webContents.executeJavaScript(
            `window.tagterm.agent.reportOutput(${JSON.stringify(s1)}, { tail: ${JSON.stringify(tail)}, silentMs: ${silentMs} })`,
          )
        const waitUntil = async (cond: () => boolean, timeoutMs: number): Promise<boolean> => {
          const start = Date.now()
          while (Date.now() - start < timeoutMs) {
            if (cond()) return true
            await sleep(100)
          }
          return false
        }
        // s1 的 pty 在恢复段被结束过：先点回它的标签页重开一条（它的 cwd 与 hooks 用的两个目录都不同，没收到过 hook 事件，不在抑制窗里）
        await clickTab('smoke-已改名')
        const recordSeen = await waitUntil(() => statusOf() !== null, 8000)
        deps.pty.write(s1, `"${fakeAgentExe}" -n 30 127.0.0.1 >nul\r`)
        const agentSeen = await waitUntil(() => agentOf() === 'claude', 8000)
        // 刚写入的命令回显是这条 pty 最后一次真实输出，渲染进程 1.5 s 后会送一份**真实**的静默报告（屏幕只有提示符与命令行，没有计时器）；
        // 它若落在下面的合成采样中间，会把刚判出的运行中打回空闲（实测偶发）。等它过去再送合成采样
        await sleep(1800)
        const idleWithAgent = statusOf()
        // 屏幕上只是「写着」提示文案：静态的两份采样不得变成运行中（用户 2026-09-18 撞到的误报）
        const mention = ['末尾任一行含 esc to interrupt 就算运行中', '> ']
        await report(mention, 0)
        await report(mention, 0)
        await sleep(200)
        const afterMention = statusOf()
        // 计时器真的在走：两份采样读数从 7s 到 8s
        await report(['✻ Cogitating… (7s · ↓ 1.2k tokens)', '> '], 0)
        await report(['✻ Cogitating… (8s · ↓ 1.3k tokens)', '> '], 0)
        const working = await waitUntil(() => statusOf() === 'working', 3000)
        const badgeWhenWorking = deps.badgeCounts()
        // 网络失败 / 重试中（2026-09-21）：屏幕上只是「引用」了一句横幅（读数不变）的两份采样不得转移（反例）；
        // 倒数 5s → 4s 的两份采样 → 等你确认（提示 = 横幅那一行）且角标 blocked 1；横幅消失、计时器继续走 → 回运行中（释放）
        const quotedBanner = ['解释一下 Retrying in 5s 这句是什么意思', '> ']
        await report(quotedBanner, 0)
        await report(quotedBanner, 0)
        await sleep(200)
        const afterQuotedBanner = statusOf()
        await report(['Connection error. · Retrying in 5s · attempt 2/10', '> '], 0)
        await report(['Connection error. · Retrying in 4s · attempt 2/10', '> '], 0)
        const retryBlocked = await waitUntil(() => statusOf() === 'blocked', 3000)
        const retryHint = deps.agent.list().find((r) => r.sessionId === s1)?.pendingHint ?? null
        const badgeWhenRetrying = deps.badgeCounts()
        await report(['✻ Cogitating… (9s · ↓ 1.4k tokens)', '> '], 0)
        await report(['✻ Cogitating… (10s · ↓ 1.5k tokens)', '> '], 0)
        const workingAfterRetry = await waitUntil(() => statusOf() === 'working', 3000)
        // 跑完：状态行换成「Cooked for …」，耗时不在括号里 → 计时器读数消失 → 离开运行中
        await report(['✻ Cooked for 8s · done 13:57', '> '], 1500)
        const leftWorking = await waitUntil(() => statusOf() !== 'working', 3000)
        const statusAfterDone = statusOf()
        deps.pty.write(s1, '\x03') // Ctrl+C 停掉假 agent
        const agentGone = await waitUntil(() => agentOf() === null, 8000)
        heuristic = {
          recordSeen,
          agentSeen,
          idleWithAgent,
          afterMention,
          mentionKeptIdle: afterMention === idleWithAgent,
          working,
          badgeWhenWorking,
          afterQuotedBanner,
          quotedKeptWorking: afterQuotedBanner === 'working',
          retryBlocked,
          retryHint,
          badgeWhenRetrying,
          workingAfterRetry,
          leftWorking,
          statusAfterDone,
          agentGone,
          badgeAfterAll: deps.badgeCounts(),
        }
      } catch (err) {
        heuristic = { error: String(err) }
      } finally {
        rmSync(fakeAgentExe, { force: true })
      }

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
            rightClick,
            settings,
            sidebar,
            termOverflow,
            lifecycle,
            restore,
            heuristic,
            processTree,
            hooks,
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
