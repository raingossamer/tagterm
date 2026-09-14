/**
 * IPC 契约的唯一真相源：通道名 + 每个通道的参数与返回类型。
 * preload 与主进程都按这里的类型实现，避免通道名与参数漂移。
 */
import type {
  AppBackground,
  LaunchCommand,
  Session,
  SessionTag,
  Settings,
  ShellKind,
  Tag,
  TagColor,
  UpdateStatus,
} from './models'

export interface CreateSessionInput {
  cwd: string
  name?: string // 缺省 = 目录末段
  shell?: ShellKind // 缺省 = cmd.exe
  tagIds?: string[] // M2：建会话后逐个 attach；attach 失败不回滚、错误原样 reject
}

/** 改 cwd / shell 只在 shell 空闲（无子进程）时允许：接口层先结束空闲 pty 再改；有程序在跑则 reject */
export type SessionPatch = Partial<
  Pick<Session, 'name' | 'cwd' | 'shell' | 'startupCmd' | 'sortOrder'>
>

/** 开机自启状态：真相在系统登录项（注册表），不落盘 */
export interface AutoLaunchStatus {
  enabled: boolean // 登录项存在（openAtLogin）
  blockedBySystem: boolean // 登录项存在但被用户在任务管理器「启动应用」里禁用
}

/** 新命令可不带 id，由主进程分配 */
export type LaunchCommandInput = Omit<LaunchCommand, 'id'> & { id?: string }

export interface SettingsPatch {
  launchCommands?: LaunchCommandInput[]
  background?: AppBackground
}

// ---- 标签（M2）----

export type TagPatch = Partial<Pick<Tag, 'name' | 'color' | 'sortOrder'>>

export interface TagListResult {
  tags: Tag[]
  sessionTags: SessionTag[]
}

export interface PtySize {
  cols: number
  rows: number
}

export interface PtyExitEvent {
  sessionId: string
  exitCode: number
  signal?: number
}

export interface PtyOpenResult {
  created: boolean // true=本次新 spawn；false=复用已在运行的 pty
  pid: number
}

// 请求 / 响应：ipcRenderer.invoke ↔ ipcMain.handle
export interface IpcInvokeMap {
  'app:get-version': { args: []; result: string }
  'app:get-os-build': { args: []; result: number } // Windows 构建号，供 xterm windowsPty 选项
  'app:list-shells': { args: []; result: ShellKind[] } // 本机可用 shell（PATH 探测）
  'app:get-data-dir': { args: []; result: string } // 数据目录（设置「关于」显示）
  'app:pick-image': { args: []; result: string | null } // 系统文件对话框选图片
  'app:get-auto-launch': { args: []; result: AutoLaunchStatus } // 登录项当前状态（未打包恒 false）
  'app:set-auto-launch': { args: [enabled: boolean]; result: AutoLaunchStatus } // 写登录项并返回实际状态；未打包 reject
  'session:list': { args: []; result: Session[] }
  'session:create': { args: [input: CreateSessionInput]; result: Session }
  'session:update': { args: [id: string, patch: SessionPatch]; result: Session } // 含 cwd / shell 时：有程序在跑 reject，空闲先 kill 再改
  'session:remove': { args: [id: string]; result: void } // 同时 kill 其 pty
  'session:pick-directory': { args: []; result: string | null }
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [patch: SettingsPatch]; result: Settings } // 补丁合并，返回全量
  'settings:read-background-image': { args: [path?: string]; result: string | null } // data: URL；未设置 / 文件不存在为 null
  'update:get-status': { args: []; result: UpdateStatus }
  'update:check': { args: []; result: void } // 结果经 update:status 事件回报
  'update:download': { args: []; result: void }
  'update:install': { args: []; result: void } // 先结束全部终端，再退出安装
  'tag:list': { args: []; result: TagListResult }
  'tag:create': { args: [name: string, color?: TagColor]; result: Tag } // 同名返回已有；颜色缺省轮转
  'tag:update': { args: [id: string, patch: TagPatch]; result: Tag } // 改名撞名 reject
  'tag:remove': { args: [id: string]; result: void } // 连带其全部关联，会话保留
  'session-tag:attach': { args: [sessionId: string, tagId: string]; result: void } // 幂等
  'session-tag:detach': { args: [sessionId: string, tagId: string]; result: void }
  'pty:open': { args: [sessionId: string, size: PtySize]; result: PtyOpenResult } // 幂等
  'pty:resize': { args: [sessionId: string, size: PtySize]; result: void }
  'pty:kill': { args: [sessionId: string]; result: void }
  'pty:is-alive': { args: [sessionId: string]; result: boolean }
}

// 单向高频：ipcRenderer.send → ipcMain.on（键入不等待响应）
export interface IpcSendMap {
  'pty:write': [sessionId: string, data: string]
}

// 主进程 → 渲染进程：webContents.send → ipcRenderer.on
export interface IpcEventMap {
  'pty:data': [sessionId: string, data: string] // 主进程侧按 ≤16 ms 或 ≥64 KB 合并后再发
  'pty:exit': [event: PtyExitEvent]
  'session:changed': [sessions: Session[]] // 任何会话数据变更后广播全量列表（主进程是真相源）
  'settings:changed': [settings: Settings] // 设置变更后广播全量
  'app:open-settings': [] // 托盘「设置」→ 渲染进程打开设置弹窗
  'update:status': [status: UpdateStatus] // 更新状态机每次变化
  'tag:changed': [result: TagListResult] // 标签或关联变更后全量广播（启动清理不广播）
}

export type SendChannel = keyof IpcSendMap
export type SendArgs<K extends SendChannel> = IpcSendMap[K]

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
export type EventChannel = keyof IpcEventMap
export type EventArgs<K extends EventChannel> = IpcEventMap[K]
