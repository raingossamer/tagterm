/**
 * 接口层：ipcMain.handle / on 的薄层 —— 校验参数 → 调服务层 → 返回，不写业务逻辑。
 * ipcMain 以参数注入（IpcMainLike），测试时可传假对象脱离 Electron 运行。
 */
import type { InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): void
}

export interface IpcDeps {
  /** 应用版本（app.getVersion()） */
  version: string
}

export function registerIpc(ipc: IpcMainLike, deps: IpcDeps): void {
  const handle = <K extends InvokeChannel>(
    channel: K,
    fn: (...args: InvokeArgs<K>) => InvokeResult<K> | Promise<InvokeResult<K>>,
  ): void => {
    ipc.handle(channel, (_event, ...args) => fn(...(args as InvokeArgs<K>)))
  }

  handle('app:get-version', () => deps.version)
}
