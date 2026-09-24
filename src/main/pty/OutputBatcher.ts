/**
 * pty 输出合并：减少 IPC 次数，但不让按键回显多等一拍 ——
 *   窗口外到达的第一块**立即**送出并开一个 16 ms 窗口；窗口内到达的块累积，窗口结束时有内容就一次送出并再开一个窗口
 *  （连续输出下仍是每 16 ms 一批），没有内容则关闭窗口、下一块又立即送出；累计 ≥ 64 KB 随时立即送出。
 * 原先每一批都等满 16 ms 才发，单次按键的回显平均多等 8 ms、最多 16 ms（perf-startup-memory 行为 1）。
 */
export const FLUSH_INTERVAL_MS = 16
export const FLUSH_THRESHOLD_BYTES = 64 * 1024

export class OutputBatcher {
  private buffer = ''
  /** 正在计时的合并窗口；null = 没有窗口在跑，下一块立即送出 */
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
      this.flush()
      this.openWindow()
    }
  }

  /** 立即送出已累积的内容（pty 退出前的收尾也用）；不动窗口 */
  flush(): void {
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

  /** 开一个合并窗口：到点时有内容就送出并续开一个，没有就关闭 */
  private openWindow(): void {
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.buffer.length === 0) return
      this.flush()
      this.openWindow()
    }, FLUSH_INTERVAL_MS)
  }
}
