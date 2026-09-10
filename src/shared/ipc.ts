/**
 * IPC 契约的唯一真相源：通道名 + 每个通道的参数与返回类型。
 * preload 与主进程都按这里的类型实现，避免通道名与参数漂移。
 */
import type { Session, ShellKind } from './models'

export interface CreateSessionInput {
  cwd: string
  name?: string // 缺省 = 目录末段
  shell?: ShellKind // 缺省 = cmd.exe
}

export type SessionPatch = Partial<Pick<Session, 'name' | 'shell' | 'startupCmd' | 'sortOrder'>>

// 请求 / 响应：ipcRenderer.invoke ↔ ipcMain.handle
export interface IpcInvokeMap {
  'app:get-version': { args: []; result: string }
  'app:list-shells': { args: []; result: ShellKind[] } // 本机可用 shell（PATH 探测）
  'session:list': { args: []; result: Session[] }
  'session:create': { args: [input: CreateSessionInput]; result: Session }
  'session:update': { args: [id: string, patch: SessionPatch]; result: Session }
  'session:remove': { args: [id: string]; result: void }
  'session:pick-directory': { args: []; result: string | null }
}

// 主进程 → 渲染进程：webContents.send → ipcRenderer.on
export interface IpcEventMap {
  'session:changed': [sessions: Session[]] // 任何会话数据变更后广播全量列表（主进程是真相源）
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
export type EventChannel = keyof IpcEventMap
export type EventArgs<K extends EventChannel> = IpcEventMap[K]
