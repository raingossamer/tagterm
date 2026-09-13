/**
 * 假终端（TerminalInstance 的测试替身）：记录 open 的 host、写入内容、fit / focus 次数、WebGL 与 dispose 状态；
 * 可手动触发 onData（模拟用户键入）与 onResize（模拟 xterm 重排）。display 由池写在 host.style 上，经 isVisible 读取。
 */
import type {
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
  size: TerminalSize = { cols: 80, rows: 24 }
  private dataHandlers: Array<(d: string) => void> = []
  private resizeHandlers: Array<(s: TerminalSize) => void> = []

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
  setWebgl(enabled: boolean): void {
    this.isWebgl = enabled
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
}
