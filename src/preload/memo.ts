/**
 * 备忘小窗的 preload（memo-floating-window）：window.tagterm 只暴露事项的增删改与关掉自己。
 * 运行在 sandbox: true 下，只能用 contextBridge / ipcRenderer；也不能 require 同目录的其他文件 ——
 * 所以 invoke / send / subscribe 这三个小函数在这里另写一份，不与主窗口的 preload 共用模块（共用会被打成公共 chunk）。
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
import type { MemoWindowApi, Unsubscribe } from '@shared/api'

function invoke<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeArgs<K>
): Promise<InvokeResult<K>> {
  return ipcRenderer.invoke(channel, ...args)
}

function send<K extends SendChannel>(channel: K, ...args: SendArgs<K>): void {
  ipcRenderer.send(channel, ...args)
}

function subscribe<K extends EventChannel>(
  channel: K,
  cb: (...args: EventArgs<K>) => void,
): Unsubscribe {
  const listener = (_event: unknown, ...args: unknown[]): void => cb(...(args as EventArgs<K>))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: MemoWindowApi = {
  memo: {
    list: () => invoke('memo:list'),
    create: (text) => invoke('memo:create', text),
    update: (id, patch) => invoke('memo:update', id, patch),
    remove: (id) => invoke('memo:remove', id),
    onChanged: (cb) => subscribe('memo:changed', cb),
  },
  memoWindow: {
    close: () => send('memo-window:close'),
    onFocusInput: (cb) => subscribe('memo-window:focus-input', cb),
  },
}

contextBridge.exposeInMainWorld('tagterm', api)
