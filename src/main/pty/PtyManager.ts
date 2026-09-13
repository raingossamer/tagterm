/**
 * 服务层（深模块）：维护 sessionId → IPty；spawn / write / resize / kill / killAll；
 * 按会话把输出合并（≤16 ms 或 ≥64 KB flush）后回调；进程退出时清理并回调。不 import electron。
 */
import * as nodePty from 'node-pty'
import type { IPty } from 'node-pty'
import type { PtyExitEvent } from '@shared/ipc'
import type { ShellKind } from '@shared/models'
import { buildSpawnSpec } from './shellArgs'
import { OutputBatcher } from './OutputBatcher'

export interface PtyManagerDeps {
  /** 已合并的输出批次 */
  onData: (sessionId: string, data: string) => void
  onExit: (e: PtyExitEvent) => void
}

export interface SpawnOptions {
  cwd: string
  shell: ShellKind
  cols: number
  rows: number
}

interface Entry {
  pty: IPty
  batcher: OutputBatcher
}

/** killAndWait 等待退出的兜底时限：exit 事件迟迟不来时不让调用方卡死 */
const EXIT_WAIT_TIMEOUT_MS = 3000

export class PtyManager {
  private readonly entries = new Map<string, Entry>()
  /** killAndWait 的等待者：会话退出（onExit 回调之后）时逐个唤醒 */
  private readonly exitWaiters = new Map<string, Array<() => void>>()

  constructor(private readonly deps: PtyManagerDeps) {}

  spawn(sessionId: string, opts: SpawnOptions): { pid: number } {
    if (this.entries.has(sessionId)) throw new Error(`会话 ${sessionId} 的终端已在运行`)
    const spec = buildSpawnSpec(opts.shell, opts.cwd, process.env)
    const pty = nodePty.spawn(spec.file, spec.commandLine, {
      name: 'xterm-256color',
      cwd: opts.cwd,
      env: spec.env,
      cols: opts.cols,
      rows: opts.rows,
      useConpty: true,
    })
    const batcher = new OutputBatcher((data) => this.deps.onData(sessionId, data))
    this.entries.set(sessionId, { pty, batcher })

    pty.onData((data) => batcher.push(data))
    pty.onExit(({ exitCode, signal }) => {
      batcher.flush()
      batcher.dispose()
      this.entries.delete(sessionId)
      console.log(`[pty] 退出 session=${sessionId} pid=${pty.pid} code=${exitCode}`)
      this.deps.onExit({ sessionId, exitCode, signal })
      this.resolveExitWaiters(sessionId)
    })
    console.log(
      `[pty] spawn session=${sessionId} pid=${pty.pid} shell=${opts.shell} cwd=${opts.cwd}`,
    )
    return { pid: pty.pid }
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  /** 运行中的 pid；未运行返回 null */
  getPid(sessionId: string): number | null {
    return this.entries.get(sessionId)?.pty.pid ?? null
  }

  /** 对不存在的会话忽略（渲染进程可能在 pty 退出后仍发按键） */
  write(sessionId: string, data: string): void {
    this.entries.get(sessionId)?.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.entries.get(sessionId)?.pty.resize(cols, rows)
  }

  kill(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    console.log(`[pty] kill session=${sessionId} pid=${entry.pty.pid}`)
    entry.pty.kill()
  }

  /**
   * 结束并等到该会话的 exit 回调已触发（onExit 广播先于本 Promise resolve）；未运行立即 resolve。
   * exit 迟迟不来时按兜底时限放行并记警告，调用方（如 session:update）不会被卡死
   */
  killAndWait(sessionId: string): Promise<void> {
    if (!this.entries.has(sessionId)) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[pty] 等待退出超时 session=${sessionId}`)
        done()
      }, EXIT_WAIT_TIMEOUT_MS)
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const waiters = this.exitWaiters.get(sessionId) ?? []
      waiters.push(done)
      this.exitWaiters.set(sessionId, waiters)
      this.kill(sessionId)
    })
  }

  /** 托盘退出 / before-quit 调用，防孤儿 conhost */
  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }

  private resolveExitWaiters(sessionId: string): void {
    const waiters = this.exitWaiters.get(sessionId)
    if (!waiters) return
    this.exitWaiters.delete(sessionId)
    for (const done of waiters) done()
  }
}
