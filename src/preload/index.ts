/**
 * preload：把 IPC 包装成 SDK 风格的 window.tagterm。
 * 运行在 sandbox: true 下，只能用 contextBridge / ipcRenderer。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  EventArgs,
  EventChannel,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  SendArgs,
  SendChannel,
} from '@shared/ipc'
import type { TagTermApi, Unsubscribe } from '@shared/api'

function invoke<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeArgs<K>
): Promise<InvokeResult<K>> {
  return ipcRenderer.invoke(channel, ...args)
}

function send<K extends SendChannel>(channel: K, ...args: SendArgs<K>): void {
  ipcRenderer.send(channel, ...args)
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
    getOsBuild: () => invoke('app:get-os-build'),
    listShells: () => invoke('app:list-shells'),
    getDataDir: () => invoke('app:get-data-dir'),
    pickImage: () => invoke('app:pick-image'),
    onOpenSettings: (cb) => subscribe('app:open-settings', cb),
  },
  session: {
    list: () => invoke('session:list'),
    create: (input) => invoke('session:create', input),
    update: (id, patch) => invoke('session:update', id, patch),
    remove: (id) => invoke('session:remove', id),
    pickDirectory: () => invoke('session:pick-directory'),
    onChanged: (cb) => subscribe('session:changed', cb),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    readBackgroundImage: () => invoke('settings:read-background-image'),
    onChanged: (cb) => subscribe('settings:changed', cb),
  },
  pty: {
    open: (sessionId, size) => invoke('pty:open', sessionId, size),
    write: (sessionId, data) => send('pty:write', sessionId, data),
    resize: (sessionId, size) => invoke('pty:resize', sessionId, size),
    kill: (sessionId) => invoke('pty:kill', sessionId),
    isAlive: (sessionId) => invoke('pty:is-alive', sessionId),
    onData: (cb) => subscribe('pty:data', cb),
    onExit: (cb) => subscribe('pty:exit', cb),
  },
}

contextBridge.exposeInMainWorld('tagterm', api)
