/**
 * 接口层：ipcMain.handle / on 的薄层 —— 校验参数 → 调服务层 → 返回，不写业务逻辑。
 * ipcMain 以参数注入（IpcMainLike），测试时可传假对象脱离 Electron 运行。
 */
import type {
  AutoLaunchStatus,
  CreateSessionInput,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
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
  type ShellKind,
  type TagColor,
  type TerminalBackground,
} from '@shared/models'
import type { PtyManager } from './pty/PtyManager'
import type { SessionStore } from './store/SessionStore'
import type { SettingsStore } from './store/SettingsStore'
import type { TagStore } from './store/TagStore'
import type { Updater } from './updater/Updater'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): void
}

export interface IpcDeps {
  /** 应用版本（app.getVersion()） */
  version: string
  /** Windows 构建号（os.release 的第三段），供 xterm windowsPty 选项 */
  osBuild: number
  store: SessionStore
  settings: SettingsStore
  tags: TagStore
  updater: Updater
  pty: PtyManager
  /** 数据目录（设置「关于」显示） */
  dataDir: string
  /** 系统目录选择框（平台层注入，服务层不 import electron） */
  pickDirectory: () => Promise<string | null>
  /** 系统文件对话框选图片（平台层注入） */
  pickImage: () => Promise<string | null>
  /** 本机可用 shell（启动时探测） */
  listShells: () => ShellKind[]
  /** shell 进程有没有子进程（processTree.hasChildProcesses；测试注入假实现） */
  hasChildProcesses: (pid: number) => Promise<boolean>
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
  handle('app:pick-image', () => deps.pickImage())
  handle('app:get-auto-launch', () => deps.getAutoLaunch())
  handle('app:set-auto-launch', (enabled) => deps.setAutoLaunch(assertAutoLaunch(enabled)))

  handle('session:list', () => deps.store.list())
  // 编排：建会话 → 逐个 attach 标签；attach 抛错原样 reject（会话已创建，不回滚）
  handle('session:create', async (input) => {
    const { tagIds = [], ...create } = assertCreateInput(input)
    const session = await deps.store.create(create)
    for (const tagId of tagIds) await deps.tags.attach(session.id, tagId)
    return session
  })
  // 编排：改目录 / Shell 只在 shell 空闲时允许 —— 有子进程（claude 等在跑）reject 不动；
  // 空闲则先结束 pty 并等到 exit 广播出去，再改记录，渲染进程收到结果时运行态已是 exited（再选中即按新配置重启）
  handle('session:update', async (id, patch) => {
    const sessionId = assertId(id)
    const p = assertPatch(patch)
    const current = deps.store.get(sessionId)
    const isConfigChanged =
      (p.cwd !== undefined && p.cwd !== current.cwd) ||
      (p.shell !== undefined && p.shell !== current.shell)
    const pid = deps.pty.getPid(sessionId)
    if (isConfigChanged && pid !== null) {
      if (await deps.hasChildProcesses(pid)) {
        throw new Error('终端里有程序正在运行，退出后再修改目录或 Shell')
      }
      await deps.pty.killAndWait(sessionId)
    }
    return deps.store.update(sessionId, p)
  })
  // 跨 store 级联在编排层顺序执行：结束 pty → 删会话 → 删其标签关联（两次写、两次广播）
  handle('session:remove', async (id) => {
    const sessionId = assertId(id)
    deps.pty.kill(sessionId)
    await deps.store.remove(sessionId)
    await deps.tags.detachAllOf(sessionId)
  })
  handle('session:pick-directory', () => deps.pickDirectory())

  handle('settings:get', () => deps.settings.get())
  handle('settings:update', (patch) => deps.settings.update(assertSettingsPatch(patch)))
  handle('settings:read-background-image', () => deps.settings.readBackgroundImage())

  handle('tag:list', () => deps.tags.list())
  handle('tag:create', (name, color) =>
    deps.tags.create(assertTagName(name), assertTagColorOpt(color)),
  )
  handle('tag:update', (id, patch) => deps.tags.update(assertTagId(id), assertTagPatch(patch)))
  handle('tag:remove', (id) => deps.tags.remove(assertTagId(id)))
  // 会话是否存在由编排层核对（TagStore 不认识会话）
  handle('session-tag:attach', (sessionId, tagId) => {
    const sid = assertId(sessionId)
    const tid = assertTagId(tagId)
    deps.store.get(sid)
    return deps.tags.attach(sid, tid)
  })
  handle('session-tag:detach', (sessionId, tagId) =>
    deps.tags.detach(assertId(sessionId), assertTagId(tagId)),
  )

  handle('update:get-status', () => deps.updater.status())
  handle('update:check', () => deps.updater.check())
  handle('update:download', () => deps.updater.download())
  handle('update:install', () => deps.updater.install())

  // 幂等：无 pty 则按会话 cwd / shell spawn，有则复用；每次打开都更新 lastOpenedAt
  handle('pty:open', async (id, size) => {
    const sessionId = assertId(id)
    const { cols, rows } = assertSize(size)
    const session = deps.store.get(sessionId)
    let created = false
    let pid = deps.pty.getPid(sessionId)
    if (pid === null) {
      pid = deps.pty.spawn(sessionId, { cwd: session.cwd, shell: session.shell, cols, rows }).pid
      created = true
    }
    await deps.store.touchOpened(sessionId)
    return { created, pid }
  })
  handle('pty:resize', (id, size) => {
    const { cols, rows } = assertSize(size)
    deps.pty.resize(assertId(id), cols, rows)
  })
  handle('pty:kill', (id) => deps.pty.kill(assertId(id)))
  handle('pty:is-alive', (id) => deps.pty.has(assertId(id)))
  on('pty:write', (id, data) => {
    if (typeof id === 'string' && typeof data === 'string') deps.pty.write(id, data)
  })
}

// ---- 参数类型守卫：非法即抛（面向用户可读的中文 message） ----

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !id) throw new Error('会话 id 不能为空')
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
  if (o.startupCmd !== undefined) {
    if (typeof o.startupCmd !== 'string') throw new Error('启动命令必须是字符串')
    out.startupCmd = o.startupCmd
  }
  if (o.sortOrder !== undefined) {
    if (!Number.isInteger(o.sortOrder)) throw new Error('排序值必须是整数')
    out.sortOrder = o.sortOrder as number
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
  if (o.terminalBackground !== undefined) {
    out.terminalBackground = assertTerminalBackground(o.terminalBackground)
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
  if (o.sortOrder !== undefined) {
    if (!Number.isInteger(o.sortOrder)) throw new Error('排序值必须是整数')
    out.sortOrder = o.sortOrder as number
  }
  return out
}

function assertTerminalBackground(bg: unknown): TerminalBackground {
  const o = (bg ?? {}) as Record<string, unknown>
  if (o.imagePath !== null && typeof o.imagePath !== 'string') {
    throw new Error('终端背景图片路径格式不正确')
  }
  if (typeof o.dimOpacity !== 'number' || !(o.dimOpacity >= 0 && o.dimOpacity <= 1)) {
    throw new Error('遮罩不透明度必须在 0 到 1 之间')
  }
  return { imagePath: o.imagePath, dimOpacity: o.dimOpacity }
}
