/**
 * 屏幕末尾上报（纯 TS，核心的协作者）：每会话两个计时器 ——
 *   静默：pty 数据到达即重置，静默 silenceMs 后读末尾上报 { tail, silentMs }（主进程据此判「等你确认」/「已完成」与当前目录）；
 *   补报：屏幕在动时（工具的 spinner 每几百毫秒重绘一次，永远静默不了）每 activeMs 读末尾上报 { tail, silentMs: 0 }，
 *     从上一次补报之后的第一次数据起算（主进程只从中找工具的「工作中」提示，判「运行中」）。
 * 读不到（实例已没了）就不报；forget / dispose 取消两种计时。内容不落日志。
 */
import type { OutputReport } from '@shared/ipc'

export interface OutputWatcherDeps {
  /** 某会话屏幕末尾的非空行；无实例为 null */
  readTail: (sessionId: string, lines: number) => string[] | null
  report: (sessionId: string, report: OutputReport) => void
  silenceMs: number
  /** 屏幕在动时多久补报一次 */
  activeMs: number
  tailLines: number
}

export class OutputWatcher {
  private readonly silenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly activeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly deps: OutputWatcherDeps) {}

  /** 该会话有数据到达：重新开始计静默；没有待发的补报则排一次 */
  touch(sessionId: string): void {
    const silence = this.silenceTimers.get(sessionId)
    if (silence !== undefined) clearTimeout(silence)
    this.silenceTimers.set(
      sessionId,
      setTimeout(() => {
        this.silenceTimers.delete(sessionId)
        this.send(sessionId, this.deps.silenceMs)
      }, this.deps.silenceMs),
    )
    if (this.activeTimers.has(sessionId)) return
    this.activeTimers.set(
      sessionId,
      setTimeout(() => {
        this.activeTimers.delete(sessionId)
        this.send(sessionId, 0)
      }, this.deps.activeMs),
    )
  }

  /** 会话移除 / 实例销毁：取消两种计时 */
  forget(sessionId: string): void {
    const silence = this.silenceTimers.get(sessionId)
    if (silence !== undefined) clearTimeout(silence)
    this.silenceTimers.delete(sessionId)
    const active = this.activeTimers.get(sessionId)
    if (active !== undefined) clearTimeout(active)
    this.activeTimers.delete(sessionId)
  }

  dispose(): void {
    for (const timer of this.silenceTimers.values()) clearTimeout(timer)
    for (const timer of this.activeTimers.values()) clearTimeout(timer)
    this.silenceTimers.clear()
    this.activeTimers.clear()
  }

  private send(sessionId: string, silentMs: number): void {
    const tail = this.deps.readTail(sessionId, this.deps.tailLines)
    if (tail) this.deps.report(sessionId, { tail, silentMs })
  }
}
