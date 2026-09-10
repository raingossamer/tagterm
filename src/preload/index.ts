/**
 * preload：把 IPC 包装成 SDK 风格的 window.tagterm。
 * 运行在 sandbox: true 下，只能用 contextBridge / ipcRenderer。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc'
import type { TagTermApi } from '@shared/api'

function invoke<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeArgs<K>
): Promise<InvokeResult<K>> {
  return ipcRenderer.invoke(channel, ...args)
}

const api: TagTermApi = {
  app: {
    getVersion: () => invoke('app:get-version'),
  },
}

contextBridge.exposeInMainWorld('tagterm', api)
