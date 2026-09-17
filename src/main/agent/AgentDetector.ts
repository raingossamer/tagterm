/**
 * 服务层：每个会话的运行时状态机（SessionRuntime），三路信号（hooks / 屏幕末尾启发式 / 进程树）在这里合成。
 * 输入全是方法调用（装配层把 PtyManager / ProcessTreeProbe / HookServer / 渲染进程的事件接过来），
 * 输出是每次记录变化回调一条记录、记录删除回调一个 id；时钟注入，不 import electron。
 */
import type { OutputReport } from '@shared/ipc'
import type { AgentKind, SessionRuntime, ShellKind } from '@shared/models'
import { classify, parsePromptCwd } from './OutputHeuristics'

export interface AgentDetectorDeps {
  now: () => number
  /** 某会话的记录变了（含新建） */
  onChange: (runtime: SessionRuntime) => void
  /** 某会话的记录被删除（pty 退出 / 会话移除） */
  onRemove: (sessionId: string) => void
}

export class AgentDetector {
  private readonly runtimes = new Map<string, SessionRuntime>()
  /** 正被查看的会话（窗口可见且聚焦时的当前页），渲染进程上报；主进程始终持有这一个值 */
  private viewedId: string | null = null

  constructor(private readonly deps: AgentDetectorDeps) {}

  /** pty 起来了：建一条空闲记录（已有则不动） */
  ptySpawned(sessionId: string): void {
    if (this.runtimes.has(sessionId)) return
    this.commit({ sessionId, alive: true, agent: null, status: 'idle' })
  }

  ptyExited(sessionId: string): void {
    this.remove(sessionId)
  }

  /** pty 有输出到达（只记事实，不看内容）：有 agent 且未被 hooks 抑制 → working */
  ptyData(sessionId: string): void {
    const current = this.runtimes.get(sessionId)
    if (!current || current.agent === null || current.status === 'working') return
    if (this.isSuppressed(current)) return
    const { pendingHint: _hint, ...rest } = current
    this.commit({ ...rest, status: 'working' })
  }

  /**
   * 渲染进程的静默末尾报告：先解析提示符更新 cwdNow（不受 agent 有无影响，解析不到则保留上次的）；
   * 有 agent 且未被抑制时：末行命中提示 → blocked（pendingHint = 那一行）；静默无提示 → 只有此前是 working / blocked
   * 才算「跑完」（正被查看则 idle，否则 done），空闲的 shell 永远不会变成「已完成」
   */
  reportOutput(sessionId: string, report: OutputReport, shell: ShellKind): void {
    const current = this.runtimes.get(sessionId)
    if (!current) return
    let next: SessionRuntime = { ...current }
    const cwdNow = parsePromptCwd(report.tail, shell)
    if (cwdNow !== null) next.cwdNow = cwdNow
    if (current.agent !== null && !this.isSuppressed(current)) {
      const result = classify(report.tail)
      if (result.kind === 'blocked') {
        next = { ...next, status: 'blocked', pendingHint: result.hint }
      } else if (current.status === 'working' || current.status === 'blocked') {
        const { pendingHint: _hint, ...rest } = next
        next = { ...rest, status: this.viewedId === sessionId ? 'idle' : 'done' }
      }
    }
    if (!isSameRuntime(current, next)) this.commit(next)
  }

  sessionRemoved(sessionId: string): void {
    this.remove(sessionId)
  }

  /**
   * 进程树快照（sessionId → 工具 | null）：agent 以它为准；快照里没有的会话不动。
   * 工具消失（退出 / Ctrl+C）→ 一律回空闲并清掉提示，不留幽灵状态
   */
  processSnapshot(agents: ReadonlyMap<string, AgentKind | null>): void {
    for (const [sessionId, agent] of agents) {
      const current = this.runtimes.get(sessionId)
      if (!current || current.agent === agent) continue
      if (agent === null) {
        const { pendingHint: _hint, ...rest } = current
        this.commit({ ...rest, agent: null, status: 'idle' })
      } else {
        this.commit({ ...current, agent })
      }
    }
  }

  /** 渲染进程上报正被查看的会话（不可见 / 失焦为 null）；「已完成未查看」一旦被查看即回空闲 */
  setViewed(sessionId: string | null): void {
    this.viewedId = sessionId
    const current = sessionId ? this.runtimes.get(sessionId) : undefined
    if (current?.status === 'done') this.commit({ ...current, status: 'idle' })
  }

  /** hooks 抑制窗：某会话收到 hooks 事件后一段时间内输出启发式不产生状态转移（Slice 5 接入） */
  private isSuppressed(_runtime: SessionRuntime): boolean {
    return false
  }

  list(): SessionRuntime[] {
    return [...this.runtimes.values()].map((r) => ({ ...r }))
  }

  private remove(sessionId: string): void {
    if (!this.runtimes.delete(sessionId)) return
    this.deps.onRemove(sessionId)
  }

  private commit(runtime: SessionRuntime): void {
    this.runtimes.set(runtime.sessionId, runtime)
    this.deps.onChange({ ...runtime })
  }
}

function isSameRuntime(a: SessionRuntime, b: SessionRuntime): boolean {
  return (
    a.alive === b.alive &&
    a.agent === b.agent &&
    a.status === b.status &&
    a.cwdNow === b.cwdNow &&
    a.pendingHint === b.pendingHint
  )
}
