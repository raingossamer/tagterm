/**
 * 服务层：每个会话的运行时状态机（SessionRuntime），三路信号（hooks / 屏幕末尾启发式 / 进程树）在这里合成。
 * 输入全是方法调用（装配层把 PtyManager / ProcessTreeProbe / HookServer / 渲染进程的事件接过来），
 * 输出是每次记录变化回调一条记录、记录删除回调一个 id；时钟注入，不 import electron。
 */
import type { AgentKind, SessionRuntime } from '@shared/models'

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

  /** 渲染进程上报正被查看的会话（不可见 / 失焦为 null） */
  setViewed(sessionId: string | null): void {
    this.viewedId = sessionId
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
