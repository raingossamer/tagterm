/**
 * IPC 契约的唯一真相源：通道名 + 每个通道的参数与返回类型。
 * preload 与主进程都按这里的类型实现，避免通道名与参数漂移。
 */
import type {
  AppBackground,
  GlobalShortcutConfig,
  LaunchCommand,
  Session,
  SessionRuntime,
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

/**
 * 改 cwd / shell 只在 shell 空闲（无子进程）时允许：接口层先结束空闲 pty 再改；有程序在跑则 reject。
 * 排序不在这里改，只走 session:reorder（整体重排）
 */
export type SessionPatch = Partial<Pick<Session, 'name' | 'cwd' | 'shell'>>

/** 开机自启状态：真相在系统登录项（注册表），不落盘 */
export interface AutoLaunchStatus {
  enabled: boolean // 登录项存在（openAtLogin）
  blockedBySystem: boolean // 登录项存在但被用户在任务管理器「启动应用」里禁用
}

/** 全局快捷键当前状态：配置 + 这次启动有没有注册上（被别的程序占着时为假，设置里显示红字） */
export interface GlobalShortcutStatus extends GlobalShortcutConfig {
  registered: boolean
}

/** 配置导入导出：渲染进程只交出终端字号（它存在渲染进程 localStorage），不传任何路径 */
export interface ConfigPrefs {
  terminalFontSize: number
}

/** 导出结果：写到的文件 */
export interface ConfigExportResult {
  path: string
}

/** 配置文件里的七项（导入按此顺序逐项应用、逐项报结果） */
export type ConfigItemKey =
  | 'tags'
  | 'launchCommands'
  | 'appearance'
  | 'globalShortcut'
  | 'autoLaunch'
  | 'hooks'
  | 'terminalFontSize'

/** 每项的结果：已应用 / 与本机相同没动 / 文件里没有 / 失败（message 是原因） */
export type ConfigItemOutcome = 'applied' | 'unchanged' | 'absent' | 'failed'

export interface ConfigItemResult {
  key: ConfigItemKey
  outcome: ConfigItemOutcome
  message?: string
}

/** 导入结果：文件、导入前的备份、逐项结果；文件里给了字号时带回来由渲染进程套用 */
export interface ConfigImportResult {
  path: string
  backupPath: string
  items: ConfigItemResult[]
  terminalFontSize?: number
}

/** 新命令可不带 id，由主进程分配 */
export type LaunchCommandInput = Omit<LaunchCommand, 'id'> & { id?: string }

export interface SettingsPatch {
  launchCommands?: LaunchCommandInput[]
  background?: AppBackground
}

// ---- 标签（M2）----

// hidden 走布尔入参：false 表示「取消隐藏」，主进程落盘时删键（可选字段缺省不写）；排序只走 tag:reorder
/**
 * 背景图：扩展名对应的 MIME + 原始字节（结构化克隆直接传，不 base64）；渲染进程自己建 Blob 对象 URL（2026-09-24）。
 * 字节数组独占一块普通 ArrayBuffer（不是 SharedArrayBuffer、不共用 Node 的缓冲池），才能直接喂给 Blob
 */
export interface BackgroundImageData {
  mime: string
  bytes: Uint8Array<ArrayBuffer>
}

export type TagPatch = Partial<Pick<Tag, 'name' | 'color'>> & { hidden?: boolean }

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
  /** 退出的是哪条 pty：重开会话时用来认出「上一条 pty 迟到的退出事件」，避免把刚开好的终端误标为已退出 */
  pid: number
}

/** 装了 hooks 的两个工具：本地 HookServer 按 URL 路径 /tagterm/hook/<agent> 区分来源 */
export type HookAgent = 'claude' | 'codex'

/** 某目标（Claude / Codex）hooks 的安装状态：installed 以配置文件里有没有我们的条目为准 */
export interface HooksStatus {
  installed: boolean
  port: number // 已安装 = 文件里写的端口；未安装 = HookServer 当前端口
  settingsPath: string
  error?: string // 文件不可读 / 不是合法 JSON 等
}
export type HooksStatusMap = Record<HookAgent, HooksStatus>

/**
 * 渲染进程的屏幕末尾报告：某会话屏幕末尾的非空行（≤ 50 行），主进程只做判定不记录。
 * silentMs > 0 = 静默了这么久后的一报（判「等你确认」/「已完成」）；0 = 屏幕还在动时的定期补报（只找工具的「工作中」提示判「运行中」）
 */
export interface OutputReport {
  tail: string[]
  silentMs: number
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
  'app:open-logs-dir': { args: []; result: void } // 在资源管理器打开日志目录：路径由主进程定，不存在先建；打不开 reject
  'app:pick-image': { args: []; result: string | null } // 系统文件对话框选图片
  'app:get-auto-launch': { args: []; result: AutoLaunchStatus } // 登录项当前状态（未打包恒 false）
  'app:set-auto-launch': { args: [enabled: boolean]; result: AutoLaunchStatus } // 写登录项并返回实际状态；未打包 reject
  'app:get-global-shortcut': { args: []; result: GlobalShortcutStatus } // 全局快捷键配置与是否注册上
  'app:set-global-shortcut': { args: [config: GlobalShortcutConfig]; result: GlobalShortcutStatus } // 先注册新的，被占用 reject 且旧的保留、不落盘；成功才写 settings.json
  'app:pause-global-shortcut': { args: [paused: boolean]; result: void } // 设置里录新键位期间暂停当前热键（只在内存）
  'app:export-config': { args: [prefs: ConfigPrefs]; result: ConfigExportResult | null } // 导出用户偏好：主进程弹保存对话框（取消为 null）→ 原子写 → 返回路径
  'app:import-config': { args: [prefs: ConfigPrefs]; result: ConfigImportResult | null } // 导入：打开对话框（取消为 null）→ 整份校验（不过 reject、什么都不动）→ 备份当前偏好 → 逐项应用 → 逐项结果
  'session:list': { args: []; result: Session[] }
  'session:create': { args: [input: CreateSessionInput]; result: Session }
  'session:update': { args: [id: string, patch: SessionPatch]; result: Session } // 含 cwd / shell 时：有程序在跑 reject，空闲先 kill 再改
  'session:remove': { args: [id: string]; result: void } // 同时 kill 其 pty
  'session:reorder': { args: [ids: string[]]; result: void } // ids 必须是全部会话 id 的一个排列；按位置写 sortOrder 1..n
  'session:pick-directory': { args: []; result: string | null }
  'session:open-directory': { args: [id: string]; result: void } // 在资源管理器打开会话的当前目录（cwdNow 优先，缺省固定目录）；路径由主进程解析，打不开 reject
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [patch: SettingsPatch]; result: Settings } // 补丁合并，返回全量
  'settings:read-background-image': { args: [path?: string]; result: BackgroundImageData | null } // MIME + 原始字节（渲染进程自己建 Blob URL）；未设置 / 文件不存在为 null
  'update:get-status': { args: []; result: UpdateStatus }
  'update:check': { args: []; result: void } // 结果经 update:status 事件回报
  'update:download': { args: []; result: void }
  'update:install': { args: []; result: void } // 先结束全部终端，再退出安装
  'tag:list': { args: []; result: TagListResult }
  'tag:create': { args: [name: string, color?: TagColor]; result: Tag } // 同名返回已有；颜色缺省轮转
  'tag:update': { args: [id: string, patch: TagPatch]; result: Tag } // 改名撞名 reject
  'tag:reorder': { args: [ids: string[]]; result: void } // ids 必须是全部标签 id 的一个排列；按位置写 sortOrder 1..n
  'tag:remove': { args: [id: string]; result: void } // 连带其全部关联，会话保留
  'session-tag:attach': { args: [sessionId: string, tagId: string]; result: void } // 幂等
  'session-tag:detach': { args: [sessionId: string, tagId: string]; result: void }
  'pty:open': { args: [sessionId: string, size: PtySize]; result: PtyOpenResult } // 幂等
  'pty:resize': { args: [sessionId: string, size: PtySize]; result: void }
  'pty:kill': { args: [sessionId: string]; result: void } // 等进程退出（pty:exit 已广播）才返回；没在跑立即返回
  'pty:is-alive': { args: [sessionId: string]; result: boolean }
  // ---- agent 状态（M3）----
  'agent:list': { args: []; result: SessionRuntime[] } // 全部会话的运行时记录（启动时镜像）
  'agent:set-viewed': { args: [sessionId: string | null]; result: void } // 正被查看的会话：当前页变化 / 焦点 / 可见性变化时上报，不可见或失焦发 null
  'agent:get-hooks-status': { args: []; result: HooksStatusMap } // 两个目标的 hooks 安装状态
  'agent:set-hooks': { args: [agent: HookAgent, enabled: boolean]; result: HooksStatus } // 安装 / 卸载某目标的 hooks，失败 reject 中文 message
}

// 单向高频：ipcRenderer.send → ipcMain.on（键入不等待响应）
export interface IpcSendMap {
  'pty:write': [sessionId: string, data: string]
  'agent:report-output': [sessionId: string, report: OutputReport] // 静默末尾报告（高频单向，非法参数静默忽略）
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
  'agent:status': [runtime: SessionRuntime] // 某会话运行时记录变化；记录删除时发 alive: false 的空闲记录
  'app:select-session': [sessionId: string] // 系统通知被点击：显示窗口并切到该会话
  'app:focus-terminal': [] // 全局快捷键唤出窗口后：把焦点交给当前终端，可直接打字
}

export type SendChannel = keyof IpcSendMap
export type SendArgs<K extends SendChannel> = IpcSendMap[K]

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
export type EventChannel = keyof IpcEventMap
export type EventArgs<K extends EventChannel> = IpcEventMap[K]
