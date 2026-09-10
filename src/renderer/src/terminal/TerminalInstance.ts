/**
 * 实例池对单个终端的最小依赖：把 xterm + addon 的细节封装在工厂里，
 * 池只做编排，测试时注入假实例即可（不启动 xterm）。
 */
export interface TerminalSize {
  cols: number
  rows: number
}

export interface Disposable {
  dispose(): void
}

export interface TerminalInstance {
  open(host: HTMLElement): void
  write(data: string): void
  focus(): void
  /** 按宿主尺寸重排；宿主不可见（量不到尺寸）时返回 null */
  fit(): TerminalSize | null
  onData(cb: (data: string) => void): Disposable
  onResize(cb: (size: TerminalSize) => void): Disposable
  /** WebGL 渲染只挂在当前可见实例（Chromium 上下文数量有限） */
  setWebgl(enabled: boolean): void
  dispose(): void
}

export type TerminalFactory = () => TerminalInstance
