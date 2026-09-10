/**
 * pty 输出合并：按 16 ms 定时或累计 ≥ 64 KB 立即 flush，减少 IPC 次数。
 */
export const FLUSH_INTERVAL_MS = 16
export const FLUSH_THRESHOLD_BYTES = 64 * 1024

export class OutputBatcher {
  private buffer = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private isDisposed = false

  constructor(private readonly onFlush: (data: string) => void) {}

  push(data: string): void {
    if (this.isDisposed) return
    this.buffer += data
    if (this.buffer.length >= FLUSH_THRESHOLD_BYTES) {
      this.flush()
      return
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.isDisposed || this.buffer.length === 0) return
    const data = this.buffer
    this.buffer = ''
    this.onFlush(data)
  }

  dispose(): void {
    this.isDisposed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.buffer = ''
  }
}
