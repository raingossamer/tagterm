/**
 * IPC 契约的唯一真相源：通道名 + 每个通道的参数与返回类型。
 * preload 与主进程都按这里的类型实现，避免通道名与参数漂移。
 */

// 请求 / 响应：ipcRenderer.invoke ↔ ipcMain.handle
export interface IpcInvokeMap {
  'app:get-version': { args: []; result: string }
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
