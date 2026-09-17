/**
 * 屏幕末尾静默上报（纯 TS，核心的协作者）：每会话一个计时器，pty 数据到达即重置；静默 silenceMs 后从实例读末尾 tailLines 行
 * 经 report 交给主进程（agent:report-output）。读不到（实例已没了）就不报；forget / dispose 取消计时。
 * 主进程靠它判定「等你确认」/「已完成」与当前目录；内容不落日志。
 */
import type { OutputReport } from '@shared/ipc'

export interface OutputWatcherDeps {
  /** 某会话屏幕末尾的非空行；无实例为 null */
  readTail: (sessionId: string, lines: number) => string[] | null
  report: (sessionId: string, report: OutputReport) => void
  silenceMs: number
  tailLines: number
}

export class OutputWatcher {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly deps: OutputWatcherDeps) {}

  /** 该会话有数据到达：重新开始计静默 */
  touch(sessionId: string): void {
    const existing = this.timers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.set(
      sessionId,
      setTimeout(() => {
        this.timers.delete(sessionId)
        const tail = this.deps.readTail(sessionId, this.deps.tailLines)
        if (tail) this.deps.report(sessionId, { tail, silentMs: this.deps.silenceMs })
      }, this.deps.silenceMs),
    )
  }

  /** 会话移除 / 实例销毁：取消计时 */
  forget(sessionId: string): void {
    const existing = this.timers.get(sessionId)
    if (existing === undefined) return
    clearTimeout(existing)
    this.timers.delete(sessionId)
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
