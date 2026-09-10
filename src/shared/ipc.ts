/**
 * IPC 契约的唯一真相源：通道名 + 每个通道的参数与返回类型。
 * preload 与主进程都按这里的类型实现，避免通道名与参数漂移。
 */
import type { LaunchCommand, Session, Settings, ShellKind, TerminalBackground } from './models'

export interface CreateSessionInput {
  cwd: string
  name?: string // 缺省 = 目录末段
  shell?: ShellKind // 缺省 = cmd.exe
}

export type SessionPatch = Partial<Pick<Session, 'name' | 'shell' | 'startupCmd' | 'sortOrder'>>

/** 新命令可不带 id，由主进程分配 */
export type LaunchCommandInput = Omit<LaunchCommand, 'id'> & { id?: string }

export interface SettingsPatch {
  launchCommands?: LaunchCommandInput[]
  terminalBackground?: TerminalBackground
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
  'session:list': { args: []; result: Session[] }
  'session:create': { args: [input: CreateSessionInput]; result: Session }
  'session:update': { args: [id: string, patch: SessionPatch]; result: Session }
  'session:remove': { args: [id: string]; result: void } // 同时 kill 其 pty
  'session:pick-directory': { args: []; result: string | null }
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [patch: SettingsPatch]; result: Settings } // 补丁合并，返回全量
  'settings:read-background-image': { args: []; result: string | null } // data: URL；未设置或文件不存在为 null
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
}

export type SendChannel = keyof IpcSendMap
export type SendArgs<K extends SendChannel> = IpcSendMap[K]

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
export type EventChannel = keyof IpcEventMap
export type EventArgs<K extends EventChannel> = IpcEventMap[K]
