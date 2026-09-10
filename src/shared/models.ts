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
