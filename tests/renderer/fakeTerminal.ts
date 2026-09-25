/**
 * 假终端（TerminalInstance 的测试替身）：记录 open 的 host、写入内容、fit / focus 次数、字号、回滚上限、WebGL 与 dispose 状态；
 * 可手动触发 onData（模拟用户键入）、onResize（模拟 xterm 重排）与 onFontZoom（模拟 Ctrl+滚轮 / Ctrl+0）。
 * display 由池写在 host.style 上，经 isVisible 读取。
 */
import type {
  FontZoom,
  SearchResult,
  TerminalInstance,
  TerminalSize,
} from '../../src/renderer/src/terminal/TerminalInstance'

export class FakeTerminal implements TerminalInstance {
  host: HTMLElement | null = null
  written = ''
  focusCount = 0
  fitCount = 0
  isWebgl = false
  isDisposed = false
  fontSize = 14
  /** 查找：当前查的词与第几处（-1 = 没有当前项）、清除高亮的次数 */
  searchQuery = ''
  searchIndex = -1
  clearSearchCount = 0
  /** fit() 的返回值；置 null 模拟宿主量不到尺寸 */
  size: TerminalSize | null = { cols: 80, rows: 24 }
  private dataHandlers: Array<(d: string) => void> = []
  private resizeHandlers: Array<(s: TerminalSize) => void> = []
  private zoomHandlers: Array<(z: FontZoom) => void> = []
  private searchHandlers: Array<(r: SearchResult) => void> = []

  open(host: HTMLElement): void {
    this.host = host
  }
  write(data: string): void {
    this.written += data
  }
  focus(): void {
    this.focusCount += 1
  }
  fit(): TerminalSize | null {
    this.fitCount += 1
    return this.size
  }
  onData(cb: (data: string) => void) {
    this.dataHandlers.push(cb)
    return { dispose: () => this.dataHandlers.splice(this.dataHandlers.indexOf(cb), 1) }
  }
  onResize(cb: (size: TerminalSize) => void) {
    this.resizeHandlers.push(cb)
    return { dispose: () => this.resizeHandlers.splice(this.resizeHandlers.indexOf(cb), 1) }
  }
  onFontZoom(cb: (zoom: FontZoom) => void) {
    this.zoomHandlers.push(cb)
    return { dispose: () => this.zoomHandlers.splice(this.zoomHandlers.indexOf(cb), 1) }
  }
  setFontSize(size: number): void {
    this.fontSize = size
  }
  /** 回滚上限的当前值与每次调用的序列（池 / 核心测试断言关闭裁、重开恢复） */
  scrollback = 5000
  scrollbackCalls: number[] = []
  setScrollback(lines: number): void {
    this.scrollback = lines
    this.scrollbackCalls.push(lines)
  }
  setWebgl(enabled: boolean): void {
    this.isWebgl = enabled
  }
  /** 在写入流里不区分大小写地数匹配（真 xterm 查的是缓冲区）；换词从第一处开始，incremental 时停在当前处 */
  findNext(query: string, options?: { incremental?: boolean }): void {
    this.find(query, 1, options?.incremental ?? false)
  }
  findPrevious(query: string): void {
    this.find(query, -1, false)
  }
  clearSearch(): void {
    this.searchQuery = ''
    this.searchIndex = -1
    this.clearSearchCount += 1
  }
  onSearchResults(cb: (result: SearchResult) => void) {
    this.searchHandlers.push(cb)
    return { dispose: () => this.searchHandlers.splice(this.searchHandlers.indexOf(cb), 1) }
  }
  private find(query: string, direction: 1 | -1, incremental: boolean): void {
    const count = query ? this.written.toLowerCase().split(query.toLowerCase()).length - 1 : 0
    if (count === 0) this.searchIndex = -1
    else if (query !== this.searchQuery || this.searchIndex < 0)
      this.searchIndex = direction > 0 ? 0 : count - 1
    else if (!incremental) this.searchIndex = (this.searchIndex + direction + count) % count
    this.searchQuery = query
    const result = { index: this.searchIndex, count }
    this.searchHandlers.forEach((h) => h(result))
  }
  /** 把写入内容按行拆开、去掉空行，取末尾 lines 行（真 xterm 读的是缓冲区，这里以写入流近似） */
  readTail(lines: number): string[] {
    return this.written
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l !== '')
      .slice(-lines)
  }
  dispose(): void {
    this.isDisposed = true
  }

  /** host 是否可见（池以 display: block / none 切换） */
  get isVisible(): boolean {
    return this.host?.style.display === 'block'
  }

  // 测试辅助：模拟用户键入 / xterm 重排
  typeInput(data: string): void {
    this.dataHandlers.forEach((h) => h(data))
  }
  emitResize(size: TerminalSize): void {
    this.resizeHandlers.forEach((h) => h(size))
  }
  /** 模拟查找插件直接给出的结果（如超出高亮上限时 index 为 -1） */
  emitSearchResults(result: SearchResult): void {
    this.searchHandlers.forEach((h) => h(result))
  }
  /** 模拟在这个终端上 Ctrl+滚轮（步数，往上滚为正）或按 Ctrl+0（'reset'） */
  emitFontZoom(zoom: FontZoom): void {
    this.zoomHandlers.forEach((h) => h(zoom))
  }
}
