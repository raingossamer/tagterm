/**
 * 无人值守烟测：设置 TAGTERM_SMOKE=1 启动时，页面加载后核查安全基线与三层贯通
 * （真实会话新建 → 打开两个终端 → 切换 / 关闭标签页 → 中文 echo 往返 → 右键 / Ctrl+V 粘贴 →
 * 标签链路：建标签 / 挂标签 / 分组与副本 / 任一 / 全部 / 搜索 / 路径条胶囊与弹出层 / 删标签 →
 * 右键菜单编辑会话改名 / 移除会话 → 真实 Ctrl+K 聚焦搜索 → 设置弹窗四段导航与全局背景往返），
 * 再在主进程侧核查「关窗只隐藏、pty 存活、托盘恢复」、「结束 pty 后整页重载 → 标签页与当前页恢复、只有当前页重新 spawn」
 * 与 tags.json 落盘，再走没装 hooks 时的状态判定、唤起区置灰 / 路径条拖拽 / 右键重启终端的真实链路，
 * 最后经会话子系统移除烟测会话（与右键「移除会话」同一条级联），再走正常退出路径。
 * 以 JSON 打印到 stdout。生产运行不触发。
 */
import { app, Menu, nativeImage, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import type { PtyManager } from './pty/PtyManager'
import type { AgentSubsystem, BadgeCounts } from './agent/AgentSubsystem'
import type { SessionSubsystem } from './session/SessionSubsystem'
import type { TagStore } from './store/TagStore'
import { judgeSmoke } from './smokeVerdict'

export interface SmokeDeps {
  /** 会话与终端的一切改动都经会话子系统，与渲染进程同一条路（移除会话走完整级联，没法绕过） */
  sessions: SessionSubsystem
  /** 标签只读：核查收尾后 tags.json 只剩空集合 */
  tags: Pick<TagStore, 'list'>
  /** 终端只读探针：pid 与是否在跑（给轮询用的同步谓词）；写入与结束一律经 sessions */
  pty: Pick<PtyManager, 'getPid' | 'has'>
  /** agent 子系统只读：hooks 端口、运行时记录、shell 空闲核对（核查与诊断用） */
  agent: Pick<AgentSubsystem, 'list' | 'isShellIdle' | 'port'>
  /** 托盘当前的角标计数（等你确认 / 运行中）；托盘还没建为 null */
  badgeCounts: () => BadgeCounts | null
  /** 全局快捷键按下时的动作（唤出 / 隐藏窗口）：烟测不注册系统热键，直接调用它核查 */
  summon: () => void
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
  // 分组刚重排：等过渲染的下一拍再量像素位置（2026-09-23 两次偶发对不齐，数值见 alignDiag）
  await sleep(100)
  // 会话名左缘落在分组头「色点与标签名之间的空格」正中（2026-09-21 用户判定）：有色点的组与「未打标签」组（透明占位点）都要对上
  const nameAligned = (name) => {
    const row = rowOf(name)
    const nameEl = row?.querySelector('.name')
    const head = row?.closest('[data-test=group]')?.querySelector('[data-test=group-head]')
    const dot = head?.querySelector('[data-test=group-dot], [data-test=group-dot-blank]')
    const title = head?.querySelector('[data-test=group-title]')
    if (!nameEl || !dot || !title) return null
    const mid = (dot.getBoundingClientRect().right + title.getBoundingClientRect().left) / 2
    return Math.abs(nameEl.getBoundingClientRect().left - mid) <= 1
  }
  const nameAlignedTagged = nameAligned('smoke-临时')
  // 对齐失败时的排查数据（数字不进门槛）：名字左缘、色点右缘、标签名左缘
  const alignDiag = (() => {
    const row = rowOf('smoke-临时')
    const head = row?.closest('[data-test=group]')?.querySelector('[data-test=group-head]')
    const rect = (el) => el?.getBoundingClientRect()
    return {
      nameLeft: rect(row?.querySelector('.name'))?.left ?? -1,
      rowLeft: rect(row)?.left ?? -1,
      dotRight: rect(head?.querySelector('[data-test=group-dot], [data-test=group-dot-blank]'))?.right ?? -1,
      titleLeft: rect(head?.querySelector('[data-test=group-title]'))?.left ?? -1,
      headLeft: rect(head)?.left ?? -1,
    }
  })()
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
  // s2 刚去掉 B、只剩 A：A 打勾、B 不打勾（选项数据本身不进门槛，这条核查进）
  const popChecksRight = popOptions.some(([n, c]) => n === 'smoke-标签A' && c) && popOptions.some(([n, c]) => n === 'smoke-标签B' && !c)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(50)
  const popClosed = !$('[data-test=tag-pop]')
  // 路径 chip 就是「打开」的入口（2026-09-21）：只守它是按钮、tooltip 末行是提示、悬停弹出层已不存在，不点它 —— 点了烟测会真的弹出资源管理器窗口
  const pathChipEl = $('[data-test=strip-path]')
  const pathChip = {
    isButton: pathChipEl?.tagName === 'BUTTON',
    titleHint: (pathChipEl?.getAttribute('title') ?? '').split('\\n').at(-1) === '点击在资源管理器中打开',
    noHoverPop: !$('[data-test=strip-copy-wrap]') && !$('[data-test=strip-open]'),
  }
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
      gotTagged, s1Groups, rowTagDots, statusDotLast, nameAlignedTagged, alignDiag, nameAlignedUntagged, groupsTagged, s2Tooltip, chipCounts, groupsAny, groupsAll, rowsAll, groupsCleared,
      rowsWhenSearching, emptyText, pillsBefore, pillRemoved, popOptions, popChecksRight, popClosed, pathChip, tagsCleared, groupsAfterRemove,
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

/** 托盘角标计数是否正好是这三个数（角标数据改写成布尔核查，才进得了发布门） */
function countsAre(
  counts: BadgeCounts | null,
  blocked: number,
  working: number,
  done: number,
): boolean {
  return (
    counts !== null &&
    counts.blocked === blocked &&
    counts.working === working &&
    counts.done === done
  )
}

/**
 * 打出烟测结果与结论两行：`[smoke]` 是全部数据（排查用），`[smoke-verdict]` 是 smokeVerdict 的判定 ——
 * 发布流水线只认后者的 "ok":true；异常分支同样打印，结论必然是失败
 */
function report(result: Record<string, unknown>): void {
  console.log('[smoke] ' + JSON.stringify(result))
  console.log('[smoke-verdict] ' + JSON.stringify(judgeSmoke(result)))
}

type Rgb = [number, number, number]

/** 16×16 纯红 PNG：终端透背景核查用，与终端底色 #0C0C0C 一眼可分 */
function solidRedPng(): Buffer {
  const size = 16
  const bgra = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i += 1) bgra.set([0, 0, 255, 255], i * 4)
  return nativeImage.createFromBitmap(bgra, { width: size, height: size }).toPNG()
}

/**
 * 当前可见终端文字区最右一列上的三个点（CSS 像素，相对内容区）：最右一列很少有字；没有可见终端为空数组。
 * 右缘取「画布右缘」与「视口右缘让出滚动条」中较小的那个：DOM 渲染器的 .xterm-screen 比容器还宽、伸到窗口外面
 */
const TERM_EDGE_POINTS = `JSON.stringify((() => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  const r = host?.querySelector('.xterm-screen')?.getBoundingClientRect()
  const v = host?.querySelector('.xterm-viewport')?.getBoundingClientRect()
  if (!r || !v || r.width < 40 || r.height < 20) return []
  const x = Math.min(r.right, v.right - 16) - 4
  return [0.35, 0.6, 0.85].map((f) => [x, r.top + r.height * f])
})())`

/** 屏幕上真实合成出来的颜色（capturePage 与屏幕取色一致，2026-09-23 实测） */
async function termEdgePixels(win: BrowserWindow): Promise<Rgb[]> {
  const points = JSON.parse(
    (await win.webContents.executeJavaScript(TERM_EDGE_POINTS)) as string,
  ) as Array<[number, number]>
  const image = await win.webContents.capturePage()
  const { width, height } = image.getSize()
  const scale = width / win.getContentBounds().width
  const bmp = image.toBitmap() // BGRA
  return points.map(([x, y]) => {
    const px = Math.min(width - 1, Math.round(x * scale))
    const py = Math.min(height - 1, Math.round(y * scale))
    const i = (py * width + px) * 4
    return [bmp[i + 2]!, bmp[i + 1]!, bmp[i]!]
  })
}

const isTermBg = (p: Rgb): boolean => p.every((c) => Math.abs(c - 12) <= 3)
// 红图之上还隔着一层半透明的浅灰面板（.main），G / B 会被抬到 60 多：比「红比绿蓝多出 30」就够分辨，且远离终端底色
const isRedTinted = ([r, g, b]: Rgb): boolean => r - Math.max(g, b) > 30
/** 多数点满足即算：最右一列偶尔会被一行长文字占到 */
const mostly = (pixels: Rgb[], test: (p: Rgb) => boolean): boolean =>
  pixels.length > 0 && pixels.filter(test).length * 2 > pixels.length

/** 当前可见终端用的哪种渲染器：WebGL 下没有 .xterm-rows（画在 canvas 上），DOM 渲染器有 */
const VISIBLE_TERM_RENDERER = `(() => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  if (!host) return 'none'
  return host.querySelector('.xterm-rows') ? 'dom' : 'webgl'
})()`

/**
 * 终端区透出全局背景的真实像素核查：不设背景 → 终端底色 #0C0C0C；设纯红背景图（面板半透明）→ 同一处带红色色偏；
 * 恢复缺省背景设置 → 回到终端底色。像素值本身是排查数据（数字不进门槛），结论是三个布尔核查。
 * 另核查：设了背景图时当前终端必须是 DOM 渲染（WebGL 会给暗淡字垫不透明黑底）；不设背景时用哪种只记录不判 ——
 * 没有 GPU 的机器（CI）上 WebGL 本来就会退回 DOM
 */
async function probeTermBackground(win: BrowserWindow): Promise<Record<string, unknown>> {
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const waitJs = async (expr: string, timeoutMs: number): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await js(`!!(${expr})`)) return true
      await sleep(100)
    }
    return false
  }
  const plain = await termEdgePixels(win)
  const plainRenderer = await js(VISIBLE_TERM_RENDERER)
  const redPath = join(app.getPath('userData'), 'smoke-red.png')
  writeFileSync(redPath, solidRedPng())
  await js(
    `window.tagterm.settings.update({ background: { imagePath: ${JSON.stringify(redPath)}, fit: 'cover', imageOpacity: 1, panelOpacity: 0.5, blurPx: 0 } })`,
  )
  const bgShown = await waitJs(
    `(document.querySelector('[data-test=app-background]')?.getAttribute('style') ?? '').includes('data:image/png')`,
    5000,
  )
  await sleep(500)
  const tinted = await termEdgePixels(win)
  const tintedRenderer = await js(VISIBLE_TERM_RENDERER)
  await js(
    `window.tagterm.settings.update({ background: { imagePath: null, fit: 'contain', imageOpacity: 0.35, panelOpacity: 0.75, blurPx: 4 } })`,
  )
  const bgCleared = await waitJs(`!document.querySelector('[data-test=app-background]')`, 5000)
  await sleep(500)
  const restored = await termEdgePixels(win)
  const restoredRenderer = await js(VISIBLE_TERM_RENDERER)
  return {
    plain,
    tinted,
    restored,
    plainRenderer,
    tintedRenderer,
    restoredRenderer,
    domRendererWithBg: tintedRenderer === 'dom',
    bgShown,
    bgCleared,
    plainIsTermBg: mostly(plain, isTermBg),
    tintedByImage: mostly(tinted, isRedTinted),
    restoredToTermBg: mostly(restored, isTermBg),
  }
}

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

/** 主进程侧轮询：条件在时限内成立即真 */
async function pollUntil(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true
    await sleep(100)
  }
  return false
}

/** 渲染进程里的表达式在时限内变为真即真 */
async function pollJs(win: BrowserWindow, expr: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await win.webContents.executeJavaScript(`!!(${expr})`)) return true
    await sleep(100)
  }
  return false
}

/** 唤起区烟测用的三条命令：两条常用、一条收进「更多」（rem 是 cmd 的注释命令，万一被敲进终端也无害） */
const SMOKE_LAUNCH_COMMANDS = [
  { label: 'smoke-a', command: 'rem smoke-a', pinned: true, sortOrder: 1 },
  { label: 'smoke-b', command: 'rem smoke-b', pinned: true, sortOrder: 2 },
  { label: 'smoke-c', command: 'rem smoke-c', pinned: false, sortOrder: 3 },
]

/** 唤起区当前的样子：按钮文字、悬停提示、是否全部置灰 / 全部可用（只给「应为真」的布尔，发布门逐个判） */
const LAUNCH_STATE = `(() => {
  const cmds = [...document.querySelectorAll('[data-test=launch-cmd]')]
  const clear = document.querySelector('[data-test=strip-clear]')
  const isGreyed = (b) => b?.getAttribute('aria-disabled') === 'true'
  return {
    labels: cmds.map((b) => b.textContent.trim()),
    titles: cmds.map((b) => b.getAttribute('title') ?? ''),
    clearTitle: clear?.getAttribute('title') ?? '',
    allGreyed: cmds.length > 0 && cmds.every(isGreyed) && isGreyed(clear),
    noneGreyed: cmds.length > 0 && !cmds.some(isGreyed) && !isGreyed(clear),
  }
})()`

/**
 * 路径条上合成拖放往返（Chromium 允许脚本派发 DragEvent，只是 dataTransfer 为 null；真实鼠标拖拽的手感靠人工验收）：
 * 平铺的 smoke-a 拖到「更多 ▾」上 → 放到「更多」末尾；展开「更多」把它拖回「唤起」小字上 → 最前面的常用按钮。每步都核对落盘顺序
 */
const LAUNCH_DRAG_SCRIPT = `(async () => {
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => [...document.querySelectorAll(sel)]
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (cond, timeoutMs = 5000) => {
    const start = Date.now()
    while (!cond()) {
      if (Date.now() - start > timeoutMs) return false
      await sleep(50)
    }
    return true
  }
  const drag = async (from, to) => {
    from?.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
    await sleep(30)
    to?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }))
    await sleep(30)
    to?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }))
    from?.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
  }
  const labels = () => $$('[data-test=launch-cmd]').map((b) => b.textContent.trim()).join(' ')
  const saved = async () => (await window.tagterm.settings.get()).launchCommands
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => (c.pinned ? '+' : '-') + c.label)
    .join(' ')
  await drag($$('[data-test=launch-cmd]')[0], $('[data-test=launch-more]'))
  const movedIntoMore = await waitFor(() => labels() === 'smoke-b')
  const savedAfterInto = await saved()
  $('[data-test=launch-more]')?.click()
  await sleep(100)
  const item = $$('[data-test=launch-more-item]').find((b) => b.textContent.trim() === 'smoke-a')
  await drag(item, $('[data-test=launch-label]'))
  const movedBack = await waitFor(() => labels() === 'smoke-a smoke-b')
  const savedAfterBack = await saved()
  return {
    movedIntoMore,
    savedAfterInto,
    intoOrderRight: savedAfterInto === '+smoke-b -smoke-c -smoke-a',
    movedBack,
    savedAfterBack,
    backOrderRight: savedAfterBack === '+smoke-a +smoke-b -smoke-c',
    popClosed: !$('[data-test=launch-more-pop]'),
  }
})()`

/** 右键左栏某会话 → 菜单「重启终端」；返回菜单项当时是否可用 */
const RIGHT_CLICK_RESTART = (name: string): string => `(async () => {
  const row = [...document.querySelectorAll('[data-test=session-row]')].find((r) => r.textContent.includes(${JSON.stringify(name)}))
  row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 120 }))
  await new Promise((r) => setTimeout(r, 50))
  const item = document.querySelector('[data-test=menu-restart]')
  const isEnabled = !!item && item.getAttribute('aria-disabled') !== 'true'
  item?.click()
  return isEnabled
})()`

/**
 * 第二批「路径条」走真实链路（launch-drag-busy-restart 行为 8）：
 *   终端里跑认不出的程序（ping）→ 进程树 → program → 唤起按钮与清屏置灰、悬停写出程序名（反例：回到提示符时一个都不灰）；
 *   置灰期间在路径条上拖动唤起按钮往返 → 落盘顺序对（置灰的按钮也能拖）；
 *   从别的标签页右键「重启终端」：有程序在跑时确认框写出程序名 → pid 换了、旧实例没了、切到该会话、新 shell 空闲按钮恢复；
 *   空闲时再重启一次：不弹确认。
 * 用自己的三条唤起命令（CI 上 PATH 里没有 claude 等，种子出来的可能是空的），结束时还原
 */
async function runLaunchBarChecks(
  win: BrowserWindow,
  deps: SmokeDeps,
  s1: string,
  s1Name: string,
): Promise<Record<string, unknown>> {
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const programOf = (): string | undefined =>
    deps.agent.list().find((r) => r.sessionId === s1)?.program
  const clickTab = (name: string): Promise<unknown> =>
    js(
      `[...document.querySelectorAll('[data-test=tab]')].find((t) => t.textContent.includes(${JSON.stringify(name)}))?.click()`,
    )
  const pidChangedFrom = (before: number | null) => (): boolean => {
    const pid = deps.pty.getPid(s1)
    return pid !== null && pid !== before
  }
  const original = await js(`window.tagterm.settings.get().then((s) => s.launchCommands)`)
  await js(
    `window.tagterm.settings.update({ launchCommands: ${JSON.stringify(SMOKE_LAUNCH_COMMANDS)} })`,
  )
  try {
    await clickTab(s1Name)
    const launchersShown = await pollJs(
      win,
      `document.querySelectorAll('[data-test=launch-cmd]').length === 2`,
      5000,
    )
    // 反例：回到提示符的空闲终端，唤起按钮一个都不灰
    const idleSeen = await pollUntil(() => deps.pty.has(s1) && programOf() === undefined, 8000)
    const idle = (await js(LAUNCH_STATE)) as Record<string, unknown>

    deps.sessions.writeTerminal(s1, 'ping -n 30 127.0.0.1 >nul\r')
    const programSeen = await pollUntil(() => programOf() === 'ping', 8000)
    const greyedSeen = await pollJs(win, `${LAUNCH_STATE}.allGreyed`, 3000)
    const busy = (await js(LAUNCH_STATE)) as { titles: string[]; clearTitle: string }
    const busyTitle = '当前在 ping 里，退出后再用'
    const drag = (await js(LAUNCH_DRAG_SCRIPT)) as Record<string, unknown>

    // 重启：先给 s1 当前的终端实例做个记号，切到别的标签页，再从左栏右键重启 s1
    const markedOld = (await js(
      `(() => { const h = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block'); if (h) h.dataset.smokeOld = '1'; return !!h })()`,
    )) as boolean
    await clickTab('smoke-r3')
    await sleep(200)
    await js(
      `window.__smokeConfirms = []; window.confirm = (m) => { window.__smokeConfirms.push(m); return true }; true`,
    )
    const pidBusy = deps.pty.getPid(s1)
    const menuEnabled = (await js(RIGHT_CLICK_RESTART(s1Name))) as boolean
    const restarted = await pollUntil(pidChangedFrom(pidBusy), 8000)
    await sleep(300)
    const afterRestart = (await js(
      `({ confirms: window.__smokeConfirms, active: document.querySelector('[data-test=tab].active [data-test=tab-name]')?.textContent ?? '', oldGone: !document.querySelector('[data-smoke-old]') })`,
    )) as { confirms: string[]; active: string; oldGone: boolean }
    const ungreyedAfterRestart = await pollJs(win, `${LAUNCH_STATE}.noneGreyed`, 8000)

    // 空闲时重启：不弹确认，照样换一条新 pty
    const pidIdle = deps.pty.getPid(s1)
    await js(RIGHT_CLICK_RESTART(s1Name))
    const idleRestarted = await pollUntil(pidChangedFrom(pidIdle), 8000)
    const confirmCount = (await js(`window.__smokeConfirms.length`)) as number

    return {
      launchersShown,
      idleSeen,
      idleNoneGreyed: idle['noneGreyed'],
      programSeen,
      greyedSeen,
      busyTitles: busy.titles,
      busyTitlesNamed:
        busy.titles.length === 2 &&
        busy.titles.every((t) => t === busyTitle) &&
        busy.clearTitle === busyTitle,
      drag,
      markedOld,
      menuEnabled,
      restarted,
      confirms: afterRestart.confirms,
      confirmedWithName:
        afterRestart.confirms.length === 1 &&
        afterRestart.confirms[0] === '终端里有程序在运行（ping），重启会结束它。继续？',
      activeAfterRestart: afterRestart.active,
      switchedToIt: afterRestart.active === s1Name,
      oldInstanceGone: afterRestart.oldGone,
      ungreyedAfterRestart,
      idleRestarted,
      idleRestartNotAsked: confirmCount === 1,
    }
  } finally {
    await js(`window.tagterm.settings.update({ launchCommands: ${JSON.stringify(original)} })`)
  }
}

/**
 * 第三批「键盘」核查用：搜索框、焦点、字号与小牌。字号取核心快照落到本机偏好的值（没存过即 14）——
 * xterm 6 在 Electron 里用 canvas 量字宽，DOM 上没有能读字号的元素；字号「真的生效」由 mode con 读到的 pty 列数证明
 */
const KEYBOARD_STATE = `(() => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  const input = document.querySelector('[data-test=terminal-search-input]')
  const active = document.activeElement
  return {
    searchOpen: !!document.querySelector('[data-test=terminal-search]'),
    searchFocused: !!input && active === input,
    count: document.querySelector('[data-test=terminal-search-count]')?.textContent ?? '',
    terminalFocused: !!host && !!active && host.contains(active) && active.tagName === 'TEXTAREA',
    fontSize: Number(localStorage.getItem('tagterm.terminalFontSize') || 14),
    badge: document.querySelector('[data-test=font-size-badge]')?.textContent ?? '',
  }
})()`

interface KeyboardState {
  searchOpen: boolean
  searchFocused: boolean
  count: string
  terminalFocused: boolean
  fontSize: number
  badge: string
}

/** 去掉 ConPTY 输出里的控制序列：它会把连续空格换成「擦除 + 光标前移」，不去掉就匹配不到行内文字 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- 要匹配的正是 ESC / BEL 这两个控制字符
  return text.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

/** 在搜索框里输入查找词：发 input 事件，与打字一样走「输入即搜」 */
const TYPE_SEARCH = (query: string): string => `(() => {
  const input = document.querySelector('[data-test=terminal-search-input]')
  if (!input) return false
  input.value = ${JSON.stringify(query)}
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

/** 在可见终端上合成 Ctrl+滚轮（只用于 finally 里把字号还原成烟测前的值；核查用的是 sendInputEvent 的真实滚轮） */
const SYNTH_CTRL_WHEEL = (steps: number): string => `(() => {
  const host = [...document.querySelectorAll('[data-test=terminal-pane] > div')].find((h) => h.style.display === 'block')
  const target = host?.querySelector('.xterm-screen')
  if (!target) return false
  for (let i = 0; i < ${Math.abs(steps)}; i += 1)
    target.dispatchEvent(new WheelEvent('wheel', { deltaY: ${steps > 0 ? -100 : 100}, ctrlKey: true, bubbles: true, cancelable: true }))
  return true
})()`

/** 设置「启动」段的全局快捷键：打开弹窗 → 读键位框 → 关掉（烟测实例不注册系统热键，dryRun 下应显示已注册、无红字） */
const SHORTCUT_SETTINGS_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  document.querySelector('[data-test=open-settings]')?.click()
  await sleep(300)
  document.querySelector('[data-test=settings-nav-startup]')?.click()
  await sleep(200)
  const key = document.querySelector('[data-test=global-shortcut-key]')?.textContent?.trim() ?? ''
  const enabled = document.querySelector('[data-test=global-shortcut-enabled]')?.checked === true
  const hasError = !!document.querySelector('[data-test=global-shortcut-error]')
  document.querySelector('[data-test=settings-close]')?.click()
  await sleep(200)
  return { key, enabled, hasError, closed: !document.querySelector('[data-test=settings-modal]') }
})()`

/**
 * 第三批「键盘」（keyboard-search-hotkey-zoom）：真实按键 / 滚轮走一遍 ——
 * 终端内搜索（Ctrl+Shift+F 不进 shell、计数、Esc 焦点回终端）、Ctrl+滚轮改字号（小牌、偏好落 localStorage、
 * 终端里 mode con 读到的列数跟着变 = pty 尺寸真的同步了）、Ctrl+0 复位、全局快捷键的唤出 / 隐藏逻辑（烟测不注册系统热键，
 * 直接调用）、设置「启动」段的键位显示。s1 是唤起区段最后重启过、正显示着的空闲会话。字号在 finally 里还原
 */
async function runKeyboardChecks(
  win: BrowserWindow,
  deps: SmokeDeps,
  s1: string,
): Promise<Record<string, unknown>> {
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const state = async (): Promise<KeyboardState> => (await js(KEYBOARD_STATE)) as KeyboardState
  const press = (keyCode: string, modifiers: Array<'control' | 'shift'> = []): void => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  // 这一段自己订阅 s1 的输出：前面「标签页恢复」核查重载过页面，渲染脚本开头装的 __smokeOutputs 已经没了
  await js(
    `(() => { if (window.__keyboardOutput === undefined) { window.__keyboardOutput = ''; window.tagterm.pty.onData((id, d) => { if (id === ${JSON.stringify(s1)}) window.__keyboardOutput += d }) } return true })()`,
  )
  const output = async (): Promise<string> => (await js(`window.__keyboardOutput ?? ''`)) as string
  /** 终端里跑 mode con，读 ConPTY 报告的列数（中文系统「列:」、英文系统「Columns:」）；读不到为 0 */
  const consoleCols = async (): Promise<number> => {
    const from = (await output()).length
    deps.sessions.writeTerminal(s1, 'mode con\r')
    const start = Date.now()
    while (Date.now() - start < 5000) {
      const match = /(?:Columns|列)\s*:\s*(\d+)/.exec(stripAnsi((await output()).slice(from)))
      if (match) return Number(match[1])
      await sleep(100)
    }
    return 0
  }
  /** 输出里（去掉控制序列后）出现了几次 */
  const occurrences = async (text: string, from: number): Promise<number> =>
    stripAnsi((await output()).slice(from)).split(text).length - 1

  win.show()
  win.focus()
  await sleep(300)
  const before = await state()
  try {
    // 1 终端内搜索：写一个唯一的词（提示符行 + 输出行 = 2 处），真实 Ctrl+Shift+F 打开，小写查（不区分大小写）
    const token = `KbdFind${Date.now().toString(36)}`
    const echoFrom = (await output()).length
    deps.sessions.writeTerminal(s1, `echo ${token}\r`)
    let echoed = false
    for (const start = Date.now(); !echoed && Date.now() - start < 5000; await sleep(100))
      echoed = (await occurrences(token, echoFrom)) >= 2
    await sleep(300)
    await js(FOCUS_TERMINAL)
    const lengthBeforeFind = (await output()).length
    press('F', ['control', 'shift'])
    const opened = await pollJs(win, `${KEYBOARD_STATE}.searchOpen`, 3000)
    const afterOpen = await state()
    await js(TYPE_SEARCH(token.toLowerCase()))
    const counted = await pollJs(win, `${KEYBOARD_STATE}.count.endsWith('共 2 处')`, 3000)
    const afterType = await state()
    await sleep(300)
    const notSentToShell = (await output()).length === lengthBeforeFind
    press('Escape')
    const closed = await pollJs(win, `!${KEYBOARD_STATE}.searchOpen`, 3000)
    const afterClose = await state()
    const search = {
      echoed,
      opened,
      inputFocused: afterOpen.searchFocused,
      counted,
      count: afterType.count,
      notSentToShell,
      closed,
      focusBackToTerminal: afterClose.terminalFocused,
    }

    // 2 字号：真实 Ctrl+滚轮三格 → 字号 +3、小牌、偏好落盘、pty 列数变少；终端里 Ctrl+0 → 回 14
    const colsBefore = await consoleCols()
    const center = (await js(TERMINAL_CENTER)) as { x: number; y: number } | null
    for (let i = 0; i < 3 && center; i += 1)
      win.webContents.sendInputEvent({
        type: 'mouseWheel',
        x: center.x,
        y: center.y,
        deltaX: 0,
        deltaY: 100,
        wheelTicksY: 1,
        canScroll: true,
        modifiers: ['control'],
      })
    const zoomed = await pollJs(win, `${KEYBOARD_STATE}.fontSize !== ${before.fontSize}`, 3000)
    const afterZoom = await state()
    await sleep(300)
    const colsAfter = await consoleCols()
    await js(FOCUS_TERMINAL)
    press('0', ['control'])
    const reset = await pollJs(win, `${KEYBOARD_STATE}.fontSize === 14`, 3000)
    const fontSize = {
      sizeBefore: before.fontSize,
      sizeAfterWheel: afterZoom.fontSize,
      zoomed,
      grewByThree: afterZoom.fontSize === before.fontSize + 3,
      badgeShown: afterZoom.badge === `字号 ${afterZoom.fontSize}`,
      colsBefore,
      colsAfter,
      colsShrank: colsBefore > 0 && colsAfter > 0 && colsAfter < colsBefore,
      resetByCtrl0: reset,
    }

    // 3 全局快捷键的唤出 / 隐藏（烟测不注册系统热键，直接调用按下时的那个函数）：
    // 前台 → 藏到托盘；藏着 → 唤出且焦点交给当前终端（先把焦点挪到左栏搜索框，证明是广播挪回来的）；最小化 → 还原
    await js(`document.querySelector('[data-test=search-input]')?.focus(); true`)
    win.show()
    win.focus()
    await sleep(300)
    const focusedBeforeHide = win.isFocused()
    deps.summon()
    const hidden = await pollUntil(() => !win.isVisible(), 3000)
    deps.summon()
    const shown = await pollUntil(() => win.isVisible(), 3000)
    const terminalFocused = await pollJs(win, `${KEYBOARD_STATE}.terminalFocused`, 3000)
    win.minimize()
    await pollUntil(() => win.isMinimized(), 3000)
    deps.summon()
    const restoredFromMinimized = await pollUntil(() => win.isVisible() && !win.isMinimized(), 3000)
    const summon = {
      focusedBeforeHide,
      hidden,
      shown,
      terminalFocused,
      restoredFromMinimized,
    }

    // 4 设置「启动」段：键位框显示缺省 Ctrl+Alt+T、开关开着、没有「被占用」红字
    const shown4 = (await js(SHORTCUT_SETTINGS_SCRIPT)) as {
      key: string
      enabled: boolean
      hasError: boolean
      closed: boolean
    }
    const settingsShortcut = {
      keyShown: shown4.key === 'Ctrl+Alt+T',
      enabled: shown4.enabled,
      noOccupiedError: !shown4.hasError,
      closed: shown4.closed,
    }

    return { search, fontSize, summon, settingsShortcut }
  } finally {
    // 字号还原成烟测前的值（数据目录跨次保留）；此时应已是 14
    const now = await state()
    if (now.fontSize !== before.fontSize) await js(SYNTH_CTRL_WHEEL(before.fontSize - now.fontSize))
  }
}

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
      deps.sessions.writeTerminal(sessionIds[0]!, 'ping -n 2 127.0.0.1\r')
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
        deps.sessions.writeTerminal(sessionIds[0]!, '\r') // 把粘进去的那行执行掉，别留在提示符上
        await sleep(300)
        rightClick = { termCenter, pasteCount }
      }

      // 终端区透出全局背景（reliability-hardening 行为 4）：xterm 6 自带样式给铺满终端区的 .xterm-viewport 写死了黑底，
      // DOM 层按设计半透明，屏幕上终端文字区却是纯黑 —— 只能看真实像素。取当前终端画布最右一列的几个点（避开文字），
      // 不设背景时应是终端底色 #0C0C0C；设一张纯红背景图后同一处带红色色偏；清掉后恢复
      const termBackground = await probeTermBackground(win)

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
      for (const id of restoreIds) await deps.sessions.killTerminal(id)
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
      // 回合因 API 错误终止（用户实机：网络断 → 「API Error: Connection lost mid-response」）：Claude Code 发 StopFailure 而不是 Stop
      // → 等你确认（黄）而不是已完成（蓝），行 tooltip 带错误细节；重新提问 → 运行中；正常 Stop（正被查看）→ 空闲
      await send('claude', { hook_event_name: 'UserPromptSubmit', cwd: claudeCwd })
      await send('claude', {
        hook_event_name: 'StopFailure',
        error: 'unknown',
        error_details: 'Connection lost mid-response. The response above may be incomplete.',
        cwd: claudeCwd,
      })
      const claudeFailedBlocked = await waitDot('smoke-r3', 'blocked')
      const failedRowTitle = (await rowState('smoke-r3'))['rowTitle']
      await send('claude', { hook_event_name: 'UserPromptSubmit', cwd: claudeCwd })
      const claudeWorkingAfterFailure = await waitDot('smoke-r3', 'working')
      await send('claude', { hook_event_name: 'Stop', cwd: claudeCwd })
      const claudeIdleAfterFailureRound = await waitDot('smoke-r3', 'idle')

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
        claudeFailedBlocked,
        failedRowTitle,
        claudeWorkingAfterFailure,
        claudeIdleAfterFailureRound,
        codexBlocked,
        codexRowTitle: codexBlockedState['rowTitle'],
        codexIdle,
        badgeWhenBlocked,
        badgeWhenIdle,
        badgeBlockedCounted: countsAre(badgeWhenBlocked, 1, 0, 0),
        badgeIdleCleared: countsAre(badgeWhenIdle, 0, 0, 0),
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
        deps.sessions.writeTerminal(s1, `"${fakeAgentExe}" -n 30 127.0.0.1 >nul\r`)
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
        deps.sessions.writeTerminal(s1, '\x03') // Ctrl+C 停掉假 agent
        const agentGone = await waitUntil(() => agentOf() === null, 8000)
        const badgeAfterAll = deps.badgeCounts()
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
          badgeAfterAll,
          badgeWorkingCounted: countsAre(badgeWhenWorking, 0, 1, 0),
          badgeRetryingCounted: countsAre(badgeWhenRetrying, 1, 0, 0),
          badgeClearedAfterAll: countsAre(badgeAfterAll, 0, 0, 0),
        }
      } catch (err) {
        heuristic = { error: String(err) }
      } finally {
        rmSync(fakeAgentExe, { force: true })
      }

      // 第二批「路径条」：唤起区置灰（认不出的程序）、路径条拖拽往返、右键重启终端（launch-drag-busy-restart）
      let launchBar: Record<string, unknown> = {}
      try {
        launchBar = await withTimeout(
          runLaunchBarChecks(win, deps, sessionIds[0]!, 'smoke-已改名'),
          90000,
          '唤起区与重启终端烟测',
        )
      } catch (err) {
        launchBar = { error: String(err) }
      }

      // 第三批「键盘」：终端内搜索、Ctrl+滚轮字号与 Ctrl+0、全局快捷键唤出 / 隐藏、设置里的键位显示
      let keyboard: Record<string, unknown> = {}
      try {
        keyboard = await withTimeout(
          runKeyboardChecks(win, deps, sessionIds[0]!),
          60000,
          '键盘烟测',
        )
      } catch (err) {
        keyboard = { error: String(err) }
      }

      // 清理烟测会话：走会话子系统的完整级联（结束 pty → 删记录 → 删关联 → 墓碑，与右键「移除会话」同一条路），
      // 之后 before-quit 的 killAll 对它们是空操作；tags.json 应已落盘且只剩空集合
      for (const id of sessionIds) await deps.sessions.remove(id)
      const remaining = deps.sessions.list().length
      const tagsFile = {
        exists: existsSync(join(app.getPath('userData'), 'tags.json')),
        remaining: deps.tags.list(),
      }
      // 日志落文件（reliability-hardening 行为 6）：烟测实例写到自己的数据目录；有启动行、行格式对；
      // 反例：烟测往终端里敲过的「你好，TagTerm」绝不能出现在日志里（终端输出与键入内容一律不记）
      const logPath = join(app.getPath('userData'), 'logs', 'main.log')
      const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
      const logFileCheck = {
        exists: existsSync(logPath),
        hasStartupLine: logText.includes('INFO  [main] 可用 shell'),
        lineFormatOk: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} (INFO |WARN |ERROR) /m.test(
          logText,
        ),
        noTerminalOutput: !logText.includes('你好，TagTerm'),
      }
      // 第三批「键盘」：应用不装菜单（Electron 默认菜单的 Ctrl+R / Ctrl+= / Alt 菜单栏都不在了）；
      // 真实 Ctrl+V 粘贴（clipboard.gotCtrlVPaste）照旧为真 = 粘贴不依赖菜单
      const appMenu = { removed: Menu.getApplicationMenu() === null }
      report({
        ...result,
        appMenu,
        clipboard,
        search,
        rightClick,
        settings,
        sidebar,
        termOverflow,
        lifecycle,
        restore,
        heuristic,
        launchBar,
        keyboard,
        processTree,
        termBackground,
        hooks,
        remaining,
        tagsFile,
        logFile: logFileCheck,
        consoleErrors,
      })
    } catch (err) {
      report({ error: String(err), ...result, consoleErrors })
    }
    deps.quit()
  })
}
