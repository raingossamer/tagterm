/**
 * 持久化数据模型（两进程共用）。落盘文件的精确结构见 Design/database/sql.md。
 */
export const SHELL_KINDS = ['cmd.exe', 'powershell.exe', 'pwsh.exe'] as const
export type ShellKind = (typeof SHELL_KINDS)[number]

export const DEFAULT_SHELL: ShellKind = 'cmd.exe'

export interface Session {
  id: string // uuid v4
  name: string // 显示名，缺省取目录末段
  cwd: string // 固定工作目录，必填
  shell: ShellKind // 默认 cmd.exe
  startupCmd?: string // M4：打开会话后自动执行
  lastAgent?: string // M3：最近唤起的工具
  sortOrder: number // 整数，越小越靠前；新建 = 现有最大值 + 1
  createdAt: string // ISO 8601
  lastOpenedAt?: string // ISO 8601，每次打开终端时更新
}

/** 唤起按钮候选：启动时探测 PATH，未安装的不显示（Plan §9 #6） */
export const DEFAULT_AGENTS = ['claude', 'gemini', 'codex', 'pi'] as const
export type AgentKind = (typeof DEFAULT_AGENTS)[number]

export const SESSIONS_FILE_VERSION = 1

export interface SessionsFile {
  version: typeof SESSIONS_FILE_VERSION
  sessions: Session[]
}

// ---- settings.json（M1 追加，Plan §13）----

/** 唤起命令：pinned 平铺在路径条，非 pinned 收进「更多 ▾」 */
export interface LaunchCommand {
  id: string // uuid v4
  label: string // 按钮文字，缺省 = command
  command: string // 写入终端的命令（不含回车）
  pinned: boolean
  sortOrder: number // 越小越靠前（平铺区与「更多」各自按此排序）
}

export interface TerminalBackground {
  imagePath: string | null // 用户选择的图片绝对路径；null = 纯色
  dimOpacity: number // 0–1，图片上方黑色遮罩的不透明度，保证文字可读
}

export const DEFAULT_TERMINAL_BACKGROUND: TerminalBackground = { imagePath: null, dimOpacity: 0.6 }

export interface Settings {
  launchCommands: LaunchCommand[]
  terminalBackground: TerminalBackground
}

export const SETTINGS_FILE_VERSION = 1

export interface SettingsFile extends Settings {
  version: typeof SETTINGS_FILE_VERSION
}

// ---- 检查更新（M1 追加，Plan §13 S10）----

/** 更新状态机：idle → checking → available | none | error；available → downloading → downloaded */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'none' | 'error'
  version?: string // available / downloading / downloaded：新版本；none：当前版本
  percent?: number // downloading：0–100 整数
  message?: string // error
}

// ---- tags.json（M2）----

/** 标签八色轮转表（原型 TAG_COLORS）：新建按当前标签数轮转，管理弹窗点色块换下一色 */
export const TAG_COLORS = [
  '#2F6FDB',
  '#2A9D5C',
  '#C98A0C',
  '#7B4FD1',
  '#D14343',
  '#1E9BA8',
  '#C8449A',
  '#6B7280',
] as const
export type TagColor = (typeof TAG_COLORS)[number]

export interface Tag {
  id: string // uuid v4
  name: string // trim 后非空，精确匹配唯一（区分大小写）
  color: TagColor
  sortOrder: number // 创建顺序：现有最大值 + 1；无排序 UI
}

/** 会话与标签的多对多关联；(sessionId, tagId) 联合唯一 */
export interface SessionTag {
  sessionId: string
  tagId: string
}

export const TAGS_FILE_VERSION = 1

export interface TagsFile {
  version: typeof TAGS_FILE_VERSION
  tags: Tag[]
  sessionTags: SessionTag[]
}
