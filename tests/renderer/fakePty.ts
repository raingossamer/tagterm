/**
 * 剧本式假 pty：实现 window.tagterm.pty 的结构子集（open / write / resize / onData / onExit），
 * 语义与主进程 PtyManager 一致 —— 退出即删条目，之后再 open 是新 spawn（created: true）。
 * 测试用 emitData / emitExit 推动事件；manualOpen 让 open 挂起，resolveOpens 后才 resolve（测竞态）。
 */
import type { PtyExitEvent, PtyOpenResult, PtySize } from '@shared/ipc'
import type { TagTermApi, Unsubscribe } from '@shared/api'

export type FakePtyPort = Pick<TagTermApi['pty'], 'open' | 'write' | 'resize' | 'onData' | 'onExit'>

export interface FakePtyOptions {
  /** open 不立即 resolve，等 resolveOpens() */
  manualOpen?: boolean
}

export interface FakeOpenRecord {
  sessionId: string
  size: PtySize
  created: boolean
}

export class FakePty implements FakePtyPort {
  /** 每次 open 的记录（含复用），按调用顺序 */
  readonly opens: FakeOpenRecord[] = []
  readonly written: Array<[sessionId: string, data: string]> = []
  readonly resizes: Array<[sessionId: string, size: PtySize]> = []
  private readonly running = new Map<string, number>()
  private readonly dataHandlers: Array<(sessionId: string, data: string) => void> = []
  private readonly exitHandlers: Array<(e: PtyExitEvent) => void> = []
  private readonly pendingOpens: Array<() => void> = []
  private nextPid = 1000
  private nextOpenFailure: unknown = undefined

  constructor(private readonly opts: FakePtyOptions = {}) {}

  open(sessionId: string, size: PtySize): Promise<PtyOpenResult> {
    if (this.nextOpenFailure !== undefined) {
      const err = this.nextOpenFailure
      this.nextOpenFailure = undefined
      this.opens.push({ sessionId, size, created: false })
      return Promise.reject(err)
    }
    let pid = this.running.get(sessionId)
    const created = pid === undefined
    if (pid === undefined) {
      pid = this.nextPid++
      this.running.set(sessionId, pid)
    }
    this.opens.push({ sessionId, size, created })
    const result: PtyOpenResult = { created, pid }
    if (!this.opts.manualOpen) return Promise.resolve(result)
    return new Promise((resolve) => this.pendingOpens.push(() => resolve(result)))
  }

  write(sessionId: string, data: string): void {
    this.written.push([sessionId, data])
  }

  resize(sessionId: string, size: PtySize): Promise<void> {
    this.resizes.push([sessionId, size])
    return Promise.resolve()
  }

  onData(cb: (sessionId: string, data: string) => void): Unsubscribe {
    this.dataHandlers.push(cb)
    return () => {
      const i = this.dataHandlers.indexOf(cb)
      if (i >= 0) this.dataHandlers.splice(i, 1)
    }
  }

  onExit(cb: (e: PtyExitEvent) => void): Unsubscribe {
    this.exitHandlers.push(cb)
    return () => {
      const i = this.exitHandlers.indexOf(cb)
      if (i >= 0) this.exitHandlers.splice(i, 1)
    }
  }

  // ---- 剧本 ----

  /** 主进程推送输出 */
  emitData(sessionId: string, data: string): void {
    for (const h of [...this.dataHandlers]) h(sessionId, data)
  }

  /**
   * pty 退出：删条目后再通知（与 PtyManager 顺序一致）。
   * `pid` 可显式指定，用来模拟「上一条 pty 迟到的退出事件」。
   */
  emitExit(sessionId: string, exitCode: number, pid?: number): void {
    const actual = pid ?? this.running.get(sessionId) ?? 0
    this.running.delete(sessionId)
    for (const h of [...this.exitHandlers]) h({ sessionId, exitCode, pid: actual })
  }

  /** 该会话当前运行中的 pid（测试用来构造迟到的退出事件） */
  pidOf(sessionId: string): number | undefined {
    return this.running.get(sessionId)
  }

  /** 下一次 open 以 err 拒绝（不登记条目，记入 opens 但 created 为 false），模拟主进程 spawn 失败 */
  failNextOpen(err: unknown): void {
    this.nextOpenFailure = err
  }

  /** manualOpen 模式：让所有挂起的 open resolve */
  resolveOpens(): void {
    const pending = this.pendingOpens.splice(0)
    for (const resolve of pending) resolve()
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId)
  }

  /** 该会话真实 spawn 的次数（created 为 true 的 open） */
  spawnCount(sessionId: string): number {
    return this.opens.filter((o) => o.sessionId === sessionId && o.created).length
  }

  /** 是否还有订阅者（测 dispose 退订） */
  get subscriberCount(): number {
    return this.dataHandlers.length + this.exitHandlers.length
  }
}
