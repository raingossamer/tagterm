/**
 * 假 ipcMain：记录 handle / on 注册的监听器，测试里用 invoke / send 直接调用，
 * 让接口层可以脱离 Electron 运行。
 */
type Listener = (event: unknown, ...args: unknown[]) => unknown

export interface FakeIpcMain {
  handle(channel: string, listener: Listener): void
  on(channel: string, listener: Listener): void
  /** 模拟 ipcRenderer.invoke */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  /** 模拟 ipcRenderer.send */
  send(channel: string, ...args: unknown[]): void
  /** 已注册的 invoke 通道名 */
  channels(): string[]
}

export function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, Listener>()
  const listeners = new Map<string, Listener>()
  const event = {}
  return {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    },
    on: (channel, listener) => {
      listeners.set(channel, listener)
    },
    invoke: async (channel, ...args) => {
      const h = handlers.get(channel)
      if (!h) throw new Error(`未注册的 invoke 通道：${channel}`)
      return h(event, ...args)
    },
    send: (channel, ...args) => {
      const l = listeners.get(channel)
      if (!l) throw new Error(`未注册的 send 通道：${channel}`)
      l(event, ...args)
    },
    channels: () => [...handlers.keys()],
  }
}
