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
  /** 用户在这个终端上 Ctrl+滚轮 / Ctrl+0：只上报，字号由上层统一决定（全部终端共用一份） */
  onFontZoom(cb: (zoom: FontZoom) => void): Disposable
  /** 换字号（不 fit；量尺寸与同步 pty 由池决定） */
  setFontSize(size: number): void
  /** 终端内查找（不区分大小写的普通文本，回滚区一起查）：高亮全部匹配并跳到下一处 / 上一处 */
  findNext(query: string, options?: FindOptions): void
  findPrevious(query: string): void
  /** 清掉查找高亮与选中 */
  clearSearch(): void
  /** 查找结果变化（查一次、或高亮着时终端又有新输出） */
  onSearchResults(cb: (result: SearchResult) => void): Disposable
  /** WebGL 渲染只挂在当前可见实例（Chromium 上下文数量有限） */
  setWebgl(enabled: boolean): void
  /** 活动缓冲区（alt-screen 时就是 TUI 画面）末尾 n 行非空行，自顶向下顺序；主进程据此判定「等你确认」与当前目录 */
  readTail(lines: number): string[]
  dispose(): void
}

/** 终端内查找的结果：共 count 处，当前是第 index 处（从 0 数；-1 = 没有当前项，如没有匹配或超出高亮上限） */
export interface SearchResult {
  index: number
  count: number
}

export interface FindOptions {
  /** 边打字边搜：当前项还匹配就停在原处（只扩展），不跳到下一处 */
  incremental?: boolean
}

/** 用户在终端上调字号：Ctrl+滚轮给步数（往上滚为正 = 变大），Ctrl+0 给 'reset'（回到默认） */
export type FontZoom = number | 'reset'

export type TerminalFactory = () => TerminalInstance
