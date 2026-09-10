/**
 * 接口层：ipcMain.handle / on 的薄层 —— 校验参数 → 调服务层 → 返回，不写业务逻辑。
 * ipcMain 以参数注入（IpcMainLike），测试时可传假对象脱离 Electron 运行。
 */
import type {
  CreateSessionInput,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  SessionPatch,
} from '@shared/ipc'
import { SHELL_KINDS, type ShellKind } from '@shared/models'
import type { SessionStore } from './store/SessionStore'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): void
}

export interface IpcDeps {
  /** 应用版本（app.getVersion()） */
  version: string
  store: SessionStore
  /** 系统目录选择框（平台层注入，服务层不 import electron） */
  pickDirectory: () => Promise<string | null>
  /** 本机可用 shell（启动时探测） */
  listShells: () => ShellKind[]
}

export function registerIpc(ipc: IpcMainLike, deps: IpcDeps): void {
  const handle = <K extends InvokeChannel>(
    channel: K,
    fn: (...args: InvokeArgs<K>) => InvokeResult<K> | Promise<InvokeResult<K>>,
  ): void => {
    ipc.handle(channel, (_event, ...args) => fn(...(args as InvokeArgs<K>)))
  }

  handle('app:get-version', () => deps.version)
  handle('app:list-shells', () => deps.listShells())

  handle('session:list', () => deps.store.list())
  handle('session:create', (input) => deps.store.create(assertCreateInput(input)))
  handle('session:update', (id, patch) => deps.store.update(assertId(id), assertPatch(patch)))
  handle('session:remove', (id) => deps.store.remove(assertId(id)))
  handle('session:pick-directory', () => deps.pickDirectory())
}

// ---- 参数类型守卫：非法即抛（面向用户可读的中文 message） ----

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !id) throw new Error('会话 id 不能为空')
  return id
}

function isShellKind(v: unknown): v is ShellKind {
  return typeof v === 'string' && (SHELL_KINDS as readonly string[]).includes(v)
}

function assertCreateInput(input: unknown): CreateSessionInput {
  const o = (input ?? {}) as Record<string, unknown>
  if (typeof o.cwd !== 'string' || !o.cwd.trim()) throw new Error('需要一个目录')
  if (o.name !== undefined && typeof o.name !== 'string') throw new Error('名称必须是字符串')
  if (o.shell !== undefined && !isShellKind(o.shell))
    throw new Error(`不支持的 shell：${String(o.shell)}`)
  return {
    cwd: o.cwd.trim(),
    name: o.name as string | undefined,
    shell: o.shell as ShellKind | undefined,
  }
}

function assertPatch(patch: unknown): SessionPatch {
  const o = (patch ?? {}) as Record<string, unknown>
  const out: SessionPatch = {}
  if (o.name !== undefined) {
    if (typeof o.name !== 'string') throw new Error('名称必须是字符串')
    out.name = o.name
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
