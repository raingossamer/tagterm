/**
 * preload：把 IPC 包装成 SDK 风格的 window.tagterm。
 * 运行在 sandbox: true 下，只能用 contextBridge / ipcRenderer。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { EventArgs, EventChannel, InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc'
import type { TagTermApi, Unsubscribe } from '@shared/api'

function invoke<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeArgs<K>
): Promise<InvokeResult<K>> {
  return ipcRenderer.invoke(channel, ...args)
}

/** 订阅主进程事件，返回取消订阅函数（实例池销毁时调用，避免监听器泄漏） */
function subscribe<K extends EventChannel>(
  channel: K,
  cb: (...args: EventArgs<K>) => void,
): Unsubscribe {
  const listener = (_event: unknown, ...args: unknown[]): void => cb(...(args as EventArgs<K>))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TagTermApi = {
  app: {
    getVersion: () => invoke('app:get-version'),
    listShells: () => invoke('app:list-shells'),
  },
  session: {
    list: () => invoke('session:list'),
    create: (input) => invoke('session:create', input),
    update: (id, patch) => invoke('session:update', id, patch),
    remove: (id) => invoke('session:remove', id),
    pickDirectory: () => invoke('session:pick-directory'),
    onChanged: (cb) => subscribe('session:changed', cb),
  },
}

contextBridge.exposeInMainWorld('tagterm', api)
