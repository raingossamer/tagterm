/**
 * 接口层：ipcMain.handle / on 的薄层 —— 校验参数 → 调服务层 → 返回。会话的跨服务编排（级联、改目录前的空闲核对、
 * 从真相源解析路径、会话存在核对）都在 SessionSubsystem，这里只守卫与转发；唯一留在这里的编排是全局快捷键
 * 「先向系统注册、成功才落盘、落盘失败换回」（靠系统资源生效的设置，见 backend.md 规范）。
 * ipcMain 以参数注入（IpcMainLike），测试时可传假对象脱离 Electron 运行。
 */
import { mkdir } from 'node:fs/promises'
import type {
  AutoLaunchStatus,
  CreateSessionInput,
  HookAgent,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  OutputReport,
  PtySize,
  SendArgs,
  SendChannel,
  LaunchCommandInput,
  SessionPatch,
  SettingsPatch,
  TagPatch,
} from '@shared/ipc'
import {
  SHELL_KINDS,
  TAG_COLORS,
  type AppBackground,
  type BackgroundFit,
  type GlobalShortcutConfig,
  type ShellKind,
  type TagColor,
} from '@shared/models'
import { describeBackgroundParamsError } from '@shared/background'
import { isValidAccelerator } from '@shared/accelerator'
import type { AgentSubsystem } from './agent/AgentSubsystem'
import type { FolderPort, SessionSubsystem } from './session/SessionSubsystem'
import type { GlobalShortcut } from './shortcut/GlobalShortcut'
import { applyGlobalShortcut } from './shortcut/applyGlobalShortcut'
import type { SettingsStore } from './store/SettingsStore'
import type { TagStore } from './store/TagStore'
import type { Updater } from './updater/Updater'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

export interface IpcDeps {
  /** 应用版本（app.getVersion()） */
  version: string
  /** Windows 构建号（os.release 的第三段），供 xterm windowsPty 选项 */
  osBuild: number
  /** 会话、会话 ↔ 标签关联与终端的唯一入口（会话的跨服务编排都在里面） */
  sessions: SessionSubsystem
  settings: SettingsStore
  /** 标签本身的增删改排（单文件操作，没有编排可藏，直连）；会话 ↔ 标签关联走 sessions */
  tags: TagStore
  updater: Updater
  /** agent 运行时子系统：运行时记录、正被查看、hooks 开关与端口 */
  agent: AgentSubsystem
  /** 全局快捷键服务（唤出 / 隐藏窗口）：注册与暂停；「先注册成功才落盘」的编排在 shortcut/applyGlobalShortcut */
  shortcut: GlobalShortcut
  /** 数据目录（设置「关于」显示） */
  dataDir: string
  /** 日志目录（装配层给定，= 数据目录下的 logs）；「打开日志目录」用 */
  logsDir: string
  /** 系统目录选择框（平台层注入，服务层不 import electron） */
  pickDirectory: () => Promise<string | null>
  /** 在资源管理器打开一个目录（平台层 electronFolders，与会话子系统共用）：打开了为 null，否则是原因 */
  folders: FolderPort
  /** 系统文件对话框选图片（平台层注入） */
  pickImage: () => Promise<string | null>
  /** 本机可用 shell（启动时探测） */
  listShells: () => ShellKind[]
  /** 系统登录项读写（平台层注入，未打包时 get 恒 false、set 抛错） */
  getAutoLaunch: () => AutoLaunchStatus
  setAutoLaunch: (enabled: boolean) => AutoLaunchStatus
}

export function registerIpc(ipc: IpcMainLike, deps: IpcDeps): void {
  const handle = <K extends InvokeChannel>(
    channel: K,
    fn: (...args: InvokeArgs<K>) => InvokeResult<K> | Promise<InvokeResult<K>>,
  ): void => {
    ipc.handle(channel, (_event, ...args) => fn(...(args as InvokeArgs<K>)))
  }
  const on = <K extends SendChannel>(channel: K, fn: (...args: SendArgs<K>) => void): void => {
    ipc.on(channel, (_event, ...args) => fn(...(args as SendArgs<K>)))
  }

  handle('app:get-version', () => deps.version)
  handle('app:get-os-build', () => deps.osBuild)
  handle('app:list-shells', () => deps.listShells())
  handle('app:get-data-dir', () => deps.dataDir)
  // 「打开日志目录」：路径由装配层给定，渲染进程不传路径；日志模块打开时已建过目录，这里再建一次兜底（建目录失败也会在打开时报出来）
  handle('app:open-logs-dir', async () => {
    await mkdir(deps.logsDir, { recursive: true })
    const error = await deps.folders.open(deps.logsDir)
    if (error) throw new Error(`打不开日志目录：${error}`)
  })
  handle('app:pick-image', () => deps.pickImage())
  handle('app:get-auto-launch', () => deps.getAutoLaunch())
  handle('app:set-auto-launch', (enabled) => deps.setAutoLaunch(assertAutoLaunch(enabled)))
  handle('app:get-global-shortcut', () => deps.shortcut.status())
  // 「先注册、成功才落盘、落盘失败换回」的编排在 shortcut/applyGlobalShortcut，与配置导入共用
  handle('app:set-global-shortcut', (config) =>
    applyGlobalShortcut(deps, assertGlobalShortcut(config)),
  )
  handle('app:pause-global-shortcut', (paused) => {
    if (assertPaused(paused)) deps.shortcut.pause()
    else deps.shortcut.resume()
  })

  handle('session:list', () => deps.sessions.list())
  handle('session:create', (input) => deps.sessions.create(assertCreateInput(input)))
  handle('session:update', (id, patch) => deps.sessions.update(assertId(id), assertPatch(patch)))
  handle('session:remove', (id) => deps.sessions.remove(assertId(id)))
  // 排列是否合法（缺 / 多 / 重复 / 不存在）由 SessionStore 判定，它才认识全部会话；接口层只守卫类型
  handle('session:reorder', (ids) => deps.sessions.reorder(assertSessionIds(ids)))
  handle('session:pick-directory', () => deps.pickDirectory())
  // 渲染进程只传会话 id，路径由主进程从真相源解析 —— 不给它「打开任意路径」的能力
  handle('session:open-directory', (id) => deps.sessions.openDirectory(assertId(id)))

  handle('settings:get', () => deps.settings.get())
  handle('settings:update', (patch) => deps.settings.update(assertSettingsPatch(patch)))
  handle('settings:read-background-image', (path) =>
    deps.settings.readBackgroundImage(assertImagePathOpt(path)),
  )

  handle('tag:list', () => deps.tags.list())
  handle('tag:create', (name, color) =>
    deps.tags.create(assertTagName(name), assertTagColorOpt(color)),
  )
  handle('tag:update', (id, patch) => deps.tags.update(assertTagId(id), assertTagPatch(patch)))
  // 排列是否合法（缺 / 多 / 重复 / 不存在）由 TagStore 判定，它才认识全部标签；接口层只守卫类型
  handle('tag:reorder', (ids) => deps.tags.reorder(assertTagIds(ids)))
  handle('tag:remove', (id) => deps.tags.remove(assertTagId(id)))
  handle('session-tag:attach', (sessionId, tagId) =>
    deps.sessions.attachTag(assertId(sessionId), assertTagId(tagId)),
  )
  handle('session-tag:detach', (sessionId, tagId) =>
    deps.sessions.detachTag(assertId(sessionId), assertTagId(tagId)),
  )

  handle('agent:list', () => deps.agent.list())
  handle('agent:set-viewed', (id) => deps.agent.setViewed(assertViewedId(id)))
  handle('agent:get-hooks-status', () => deps.agent.hooksStatus())
  handle('agent:set-hooks', (agent, enabled) =>
    deps.agent.setHooks(assertHookAgent(agent), assertHooksEnabled(enabled)),
  )

  handle('update:get-status', () => deps.updater.status())
  handle('update:check', () => deps.updater.check())
  handle('update:download', () => deps.updater.download())
  handle('update:install', () => deps.updater.install())

  handle('pty:open', (id, size) => deps.sessions.openTerminal(assertId(id), assertSize(size)))
  handle('pty:resize', (id, size) => {
    const checked = assertSize(size) // 先尺寸后 id：两个参数都非法时报哪一句，与以前一致
    deps.sessions.resizeTerminal(assertId(id), checked)
  })
  // 等进程真正退出才返回：pty:exit 先广播出去，渲染进程随后重开（重启终端）不会被这条迟到的退出标成已退出
  handle('pty:kill', (id) => deps.sessions.killTerminal(assertId(id)))
  handle('pty:is-alive', (id) => deps.sessions.isTerminalAlive(assertId(id)))
  on('pty:write', (id, data) => {
    if (typeof id === 'string' && typeof data === 'string') deps.sessions.writeTerminal(id, data)
  })
  // 静默末尾报告（单向）：非法参数静默忽略；未知会话由子系统静默丢弃
  on('agent:report-output', (id, report) => {
    if (typeof id === 'string' && id && isOutputReport(report))
      deps.sessions.reportOutput(id, report)
  })
}

// ---- 参数类型守卫：非法即抛（面向用户可读的中文 message） ----

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !id) throw new Error('会话 id 不能为空')
  return id
}

const MAX_REPORT_LINES = 50

function isOutputReport(report: unknown): report is OutputReport {
  const o = (report ?? {}) as Record<string, unknown>
  return (
    Array.isArray(o.tail) &&
    o.tail.length <= MAX_REPORT_LINES &&
    o.tail.every((line) => typeof line === 'string') &&
    Number.isInteger(o.silentMs) &&
    (o.silentMs as number) >= 0
  )
}

function assertHookAgent(agent: unknown): HookAgent {
  if (agent !== 'claude' && agent !== 'codex') throw new Error('hooks 目标只能是 claude 或 codex')
  return agent
}

function assertHooksEnabled(enabled: unknown): boolean {
  if (typeof enabled !== 'boolean') throw new Error('hooks 开关参数必须是布尔')
  return enabled
}

function assertViewedId(id: unknown): string | null {
  if (id === null) return null
  if (typeof id !== 'string' || !id) throw new Error('会话 id 必须是非空字符串或 null')
  return id
}

function isShellKind(v: unknown): v is ShellKind {
  return typeof v === 'string' && (SHELL_KINDS as readonly string[]).includes(v)
}

function assertSize(size: unknown): PtySize {
  const o = (size ?? {}) as Record<string, unknown>
  const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
  if (!isPositiveInt(o.cols) || !isPositiveInt(o.rows)) throw new Error('终端尺寸必须是正整数')
  return { cols: o.cols, rows: o.rows }
}

function assertCreateInput(input: unknown): CreateSessionInput {
  const o = (input ?? {}) as Record<string, unknown>
  if (typeof o.cwd !== 'string' || !o.cwd.trim()) throw new Error('需要一个目录')
  if (o.name !== undefined && typeof o.name !== 'string') throw new Error('名称必须是字符串')
  if (o.shell !== undefined && !isShellKind(o.shell))
    throw new Error(`不支持的 shell：${String(o.shell)}`)
  if (
    o.tagIds !== undefined &&
    (!Array.isArray(o.tagIds) || !o.tagIds.every((id) => typeof id === 'string' && id))
  ) {
    throw new Error('标签 id 列表格式不正确')
  }
  return {
    cwd: o.cwd.trim(),
    name: o.name as string | undefined,
    shell: o.shell as ShellKind | undefined,
    tagIds: o.tagIds as string[] | undefined,
  }
}

function assertPatch(patch: unknown): SessionPatch {
  const o = (patch ?? {}) as Record<string, unknown>
  const out: SessionPatch = {}
  if (o.name !== undefined) {
    if (typeof o.name !== 'string') throw new Error('名称必须是字符串')
    out.name = o.name
  }
  if (o.cwd !== undefined) {
    if (typeof o.cwd !== 'string' || !o.cwd.trim()) throw new Error('需要一个目录')
    out.cwd = o.cwd.trim()
  }
  if (o.shell !== undefined) {
    if (!isShellKind(o.shell)) throw new Error(`不支持的 shell：${String(o.shell)}`)
    out.shell = o.shell
  }
  return out
}

function assertSettingsPatch(patch: unknown): SettingsPatch {
  const o = (patch ?? {}) as Record<string, unknown>
  const out: SettingsPatch = {}
  if (o.launchCommands !== undefined) {
    if (!Array.isArray(o.launchCommands)) throw new Error('唤起命令列表格式不正确')
    out.launchCommands = o.launchCommands.map(assertLaunchCommand)
  }
  if (o.background !== undefined) {
    out.background = assertBackground(o.background)
  }
  return out
}

function assertLaunchCommand(item: unknown): LaunchCommandInput {
  const o = (item ?? {}) as Record<string, unknown>
  if (typeof o.command !== 'string' || !o.command.trim()) throw new Error('唤起命令不能为空')
  if (
    (o.id !== undefined && typeof o.id !== 'string') ||
    typeof o.label !== 'string' ||
    typeof o.pinned !== 'boolean' ||
    !Number.isInteger(o.sortOrder)
  ) {
    throw new Error('唤起命令格式不正确')
  }
  return {
    id: o.id as string | undefined,
    label: o.label.trim() || o.command.trim(),
    command: o.command.trim(),
    pinned: o.pinned,
    sortOrder: o.sortOrder as number,
  }
}

function assertAutoLaunch(enabled: unknown): boolean {
  if (typeof enabled !== 'boolean') throw new Error('开机自启参数必须是布尔')
  return enabled
}

function assertGlobalShortcut(config: unknown): GlobalShortcutConfig {
  const o = (typeof config === 'object' && config !== null ? config : {}) as Record<string, unknown>
  if (typeof o.enabled !== 'boolean' || !isValidAccelerator(o.accelerator)) {
    throw new Error('快捷键设置格式不正确')
  }
  return { enabled: o.enabled, accelerator: o.accelerator }
}

function assertPaused(paused: unknown): boolean {
  if (typeof paused !== 'boolean') throw new Error('暂停参数必须是布尔')
  return paused
}

function assertTagId(id: unknown): string {
  if (typeof id !== 'string' || !id) throw new Error('标签 id 不能为空')
  return id
}

function assertTagName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new Error('标签名不能为空')
  return name
}

function assertTagColor(color: unknown): TagColor {
  if (typeof color !== 'string' || !(TAG_COLORS as readonly string[]).includes(color)) {
    throw new Error(`不支持的颜色：${String(color)}`)
  }
  return color as TagColor
}

function assertTagColorOpt(color: unknown): TagColor | undefined {
  return color === undefined ? undefined : assertTagColor(color)
}

function assertTagPatch(patch: unknown): TagPatch {
  const o = (patch ?? {}) as Record<string, unknown>
  const out: TagPatch = {}
  if (o.name !== undefined) out.name = assertTagName(o.name)
  if (o.color !== undefined) out.color = assertTagColor(o.color)
  if (o.hidden !== undefined) {
    if (typeof o.hidden !== 'boolean') throw new Error('hidden 必须是布尔值')
    out.hidden = o.hidden
  }
  return out
}

function assertSessionIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('会话 id 列表格式不正确')
  }
  return ids as string[]
}

function assertTagIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('标签 id 列表格式不正确')
  }
  return ids as string[]
}

function assertImagePathOpt(path: unknown): string | undefined {
  if (path === undefined) return undefined
  if (typeof path !== 'string' || !path.trim()) throw new Error('背景图片路径格式不正确')
  return path
}

function assertBackground(bg: unknown): AppBackground {
  const o = (bg ?? {}) as Record<string, unknown>
  if (o.imagePath !== null && typeof o.imagePath !== 'string') {
    throw new Error('背景图片路径格式不正确')
  }
  // 四个参数的规则与配置文件的解析共用（shared/background），同一句中文
  const error = describeBackgroundParamsError(o)
  if (error) throw new Error(error)
  return {
    imagePath: o.imagePath,
    fit: o.fit as BackgroundFit,
    imageOpacity: o.imageOpacity as number,
    panelOpacity: o.panelOpacity as number,
    blurPx: o.blurPx as number,
  }
}
