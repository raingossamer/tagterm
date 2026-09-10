/**
 * preload 暴露到 window.tagterm 的 SDK 风格 API（preload 实现、renderer 消费）。
 * 每个操作一个具体函数，渲染进程测试时按函数 mock。
 */
export type Unsubscribe = () => void

export interface TagTermApi {
  app: {
    getVersion(): Promise<string>
  }
}
