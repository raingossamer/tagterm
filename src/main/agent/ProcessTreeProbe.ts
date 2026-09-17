/**
 * 服务层：进程树探针。只在至少有一个被 watch 的 pty 时每 intervalMs 跑一轮：对每个 pty 的 shell pid 取递归子树
 *（listSubtree 由装配层用 @vscode/windows-process-tree 注入，不含 shell 自己），经 detectAgent 映射成 AgentKind | null，
 * 整体快照与上一轮不同才回调。也回答 session:update 的「shell 是否空闲」（hasChildren）。定时器可注入，不 import electron。
 */
import type { AgentKind } from '@shared/models'
import { detectAgent, type ProcessNode } from './processMatch'

export type AgentSnapshot = Map<string, AgentKind | null>

export interface ProcessTreeProbeDeps {
  /** 某 pid 的全部后代进程（不含它自己）；进程已不存在时可抛错或返回空 */
  listSubtree: (pid: number) => Promise<ProcessNode[]>
  intervalMs: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export class ProcessTreeProbe {
  private readonly watched = new Map<string, number>()
  private readonly listeners = new Set<(snapshot: AgentSnapshot) => void>()
  private last: AgentSnapshot = new Map()
  private timer: unknown = null
  private isTicking = false
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly deps: ProcessTreeProbeDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /** 开始盯着某会话的 shell 进程；第一个被 watch 的 pty 启动定时器 */
  watch(sessionId: string, pid: number): void {
    this.watched.set(sessionId, pid)
    if (this.timer === null) this.schedule()
  }

  /** 不再盯着；最后一个被 unwatch 时停掉定时器 */
  unwatch(sessionId: string): void {
    if (!this.watched.delete(sessionId)) return
    if (this.watched.size === 0 && this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  onSnapshot(listener: (snapshot: AgentSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** shell 是否有任何子进程（session:update 改目录 / Shell 前的空闲核对） */
  async hasChildren(pid: number): Promise<boolean> {
    return (await this.deps.listSubtree(pid)).length > 0
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.watched.clear()
    this.listeners.clear()
  }

  private schedule(): void {
    this.timer = this.setTimer(() => void this.tick(), this.deps.intervalMs)
  }

  private async tick(): Promise<void> {
    if (this.isTicking) return
    this.isTicking = true
    try {
      const next: AgentSnapshot = new Map()
      for (const [sessionId, pid] of [...this.watched]) {
        let subtree: ProcessNode[]
        try {
          subtree = await this.deps.listSubtree(pid)
        } catch {
          subtree = [] // 进程已不存在或查询失败：按没有 agent 处理，pty 退出事件随后会 unwatch
        }
        if (this.watched.has(sessionId)) next.set(sessionId, detectAgent(subtree))
      }
      if (!isSameSnapshot(this.last, next)) {
        this.last = next
        for (const listener of [...this.listeners]) listener(new Map(next))
      }
    } finally {
      this.isTicking = false
      // 一轮跑完再排下一轮（不用 setInterval：原生查询再快也不让两轮叠在一起）
      this.timer = null
      if (this.watched.size > 0) this.schedule()
    }
  }
}

function isSameSnapshot(a: AgentSnapshot, b: AgentSnapshot): boolean {
  if (a.size !== b.size) return false
  for (const [id, agent] of a) if (!b.has(id) || b.get(id) !== agent) return false
  return true
}
