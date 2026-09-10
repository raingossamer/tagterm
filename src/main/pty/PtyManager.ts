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

export class PtyManager {
  private readonly entries = new Map<string, Entry>()

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

  /** 托盘退出 / before-quit 调用，防孤儿 conhost */
  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }
}
