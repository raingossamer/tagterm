/**
 * 服务层：每个会话的运行时状态机（SessionRuntime），三路信号（hooks / 屏幕末尾启发式 / 进程树）在这里合成。
 * 输入全是方法调用（AgentSubsystem 把 PtyManager 的 spawn / exit、ProcessTreeProbe 的快照、HookServer 的载荷、渲染进程的屏幕末尾报告接过来；
 * hooks 事件按 agent 的转移规则见 hookContract），输出是每次记录变化回调一条记录、记录删除回调一个 id；时钟注入，不 import electron。
 * 「有输出到达」不是信号：启动工具、在工具里打字、界面重绘都有输出，但都不是在干活；
 * 「运行中」只认屏幕上**在走的计时器**（工具状态行括号里的耗时，相邻两次采样比较，见 OutputHeuristics）——
 * 固定文案匹配换过一版又退掉了：工具改版就漏报，而屏幕上任何提到该文案的文字都会把会话永久钉在运行中（用户 2026-09-18 实测）。
 * 「网络失败 / 重试中」同理只认**在倒数的计时器**（重试横幅里的「Retrying in 4s」），判成「等你确认」提醒人去处理；
 * hooks 没有这种事件，所以这条路不受抑制窗约束（用户 2026-09-21 判定）。
 */
import type { HookAgent, OutputReport } from '@shared/ipc'
import type { SessionRuntime } from '@shared/models'
import { HOOK_CONTRACTS } from './hookContract'
import type { ProcessState } from './ProcessTreeProbe'
import {
  classify,
  hasCountedDown,
  hasTicked,
  parseElapsedSeconds,
  parsePromptCwd,
  parseRetryCountdown,
  retryBannerLine,
} from './OutputHeuristics'

/** 收到 hooks 事件后多久内输出启发式不产生状态转移（最可靠的信号说了算） */
const HOOK_SUPPRESS_MS = 30_000
/** 「等你确认」提示的最大长度（与 hooks 的 message 截断一致） */
const HINT_MAX_LENGTH = 200

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
  /** 每会话最近一次 hooks 事件的时间：抑制窗以它起算 */
  private readonly hookSeenAt = new Map<string, number>()
  /** 每会话上一份屏幕末尾报告里的计时器读数（秒）：与新报告比较即知工具是否在干活 */
  private readonly elapsedSeen = new Map<string, number[]>()
  /** 每会话上一份报告里重试横幅的倒数读数（秒）：与新报告比较即知工具是否在等网络 / 重试 */
  private readonly countdownSeen = new Map<string, number[]>()
  /**
   * 因倒数而进入 blocked 的会话：hooks 没有「网络失败」这种事件，所以这条路进出都不受抑制窗约束
   * （否则提问 5 s 后断网要等 30 s 才变黄，Esc 中断后又可能卡在黄色）；任一 hooks 事件到达即撤销，离开 blocked 即清
   */
  private readonly retryBlocked = new Set<string>()

  constructor(private readonly deps: AgentDetectorDeps) {}

  /** pty 起来了：建一条空闲记录（已有则不动） */
  ptySpawned(sessionId: string): void {
    if (this.runtimes.has(sessionId)) return
    this.commit({ sessionId, alive: true, agent: null, status: 'idle' })
  }

  ptyExited(sessionId: string): void {
    this.remove(sessionId)
  }

  /**
   * 渲染进程的屏幕末尾报告，两种节奏：屏幕在动时每秒一次（silentMs 0）、静默 1.5 s 后一次（silentMs > 0）。
   * 先解析提示符更新 cwdNow（不受 agent 有无影响，解析不到则保留上次的），再记下这一屏的计时器与倒数读数（同样不受影响：
   * agent 被进程树发现时才有上一次的读数可比）。有 agent 且（未被 hooks 抑制、或走的是倒数这条不受抑制的路）时：
   *   重试横幅的倒数比上一次采样往前走了 → blocked（pendingHint = 横幅那一行；两种报告都认，从任何状态都转；
   *     同屏计时器也在走时倒数优先 —— 网络失败要提醒人，不是「运行中」）；
   *   因倒数而 blocked 且倒数还在屏上（这一秒采样读数没变）→ 不放行，等横幅消失；
   *   静默且末行命中提示模式 → blocked（pendingHint = 那一行；屏幕在动时不判，重绘中途的一帧不算等人）；
   *   计时器比上一次采样往前走了 → working（两种报告都认；从 blocked 也转 = 用户回答后 / 重试成功后工具继续干活，提示清掉）；
   *   静默且计时器没动 → 只有此前是 working / blocked 才算「跑完」（正被查看则 idle，否则 done），空闲的 shell 永远不会变成「已完成」；
   *   屏幕在动但计时器没动（欢迎画面、在工具里打字、静态文字）→ 不转移
   */
  reportOutput(sessionId: string, report: OutputReport): void {
    const current = this.runtimes.get(sessionId)
    if (!current) return
    let next: SessionRuntime = { ...current }
    const cwdNow = parsePromptCwd(report.tail)
    if (cwdNow !== null) next.cwdNow = cwdNow
    const seconds = parseElapsedSeconds(report.tail)
    const previous = this.elapsedSeen.get(sessionId)
    this.elapsedSeen.set(sessionId, seconds)
    const isTicking = previous !== undefined && hasTicked(previous, seconds)
    const countdown = parseRetryCountdown(report.tail)
    const previousCountdown = this.countdownSeen.get(sessionId)
    this.countdownSeen.set(sessionId, countdown)
    const isCountingDown =
      previousCountdown !== undefined && hasCountedDown(previousCountdown, countdown)
    const isRetryBlocked = this.retryBlocked.has(sessionId)
    if (
      current.agent !== null &&
      (isCountingDown || isRetryBlocked || !this.isSuppressed(current))
    ) {
      const result = classify(report.tail)
      const isSilent = report.silentMs > 0
      const { pendingHint: _hint, ...bare } = next
      if (isCountingDown) {
        const banner = (retryBannerLine(report.tail) ?? '').slice(0, HINT_MAX_LENGTH)
        next = { ...bare, status: 'blocked', pendingHint: banner }
        this.retryBlocked.add(sessionId)
      } else if (isRetryBlocked && countdown.length > 0) {
        // 横幅还在（只是这一秒读数没变）：继续等，不让同屏的计时器把它放行成运行中
      } else if (isSilent && result.kind === 'blocked') {
        next = { ...next, status: 'blocked', pendingHint: result.hint }
      } else if (isTicking) {
        next = { ...bare, status: 'working' }
      } else if (isSilent && (current.status === 'working' || current.status === 'blocked')) {
        next = { ...bare, status: this.viewedId === sessionId ? 'idle' : 'done' }
      }
    }
    if (!isSameRuntime(current, next)) this.commit(next)
  }

  sessionRemoved(sessionId: string): void {
    this.remove(sessionId)
  }

  /**
   * 进程树快照（sessionId → 工具 | null 与 shell 下在跑的程序名）：agent 与 program 以它为准；快照里没有的会话不动。
   * 工具消失（退出 / Ctrl+C）→ 一律回空闲并清掉提示，不留幽灵状态。
   * 认不出的程序只记 program，不设 agent —— 状态点与屏幕判定仍只对四个工具生效（构建脚本打出的「(12s)」不该算运行中）
   */
  processSnapshot(snapshot: ReadonlyMap<string, ProcessState>): void {
    for (const [sessionId, { agent, program }] of snapshot) {
      const current = this.runtimes.get(sessionId)
      if (!current) continue
      const { program: _program, ...rest } = current
      let next: SessionRuntime = rest
      if (agent !== current.agent) {
        if (agent === null) {
          const { pendingHint: _hint, ...withoutHint } = rest
          next = { ...withoutHint, agent: null, status: 'idle' }
        } else {
          next = { ...rest, agent }
        }
      }
      if (program !== null) next = { ...next, program }
      if (!isSameRuntime(current, next)) this.commit(next)
    }
  }

  /**
   * hooks 事件（装配层已按 cwd 映射到会话，可能多个）。共通规则在这里：SessionStart → 记 agent；SessionEnd → 清 agent、idle；
   * 其余事件要求会话已有 agent（进程树或 SessionStart 给的），转移规则见 hookContract 各 agent 的 interpret。
   * 任一事件都刷新该会话的抑制窗。
   */
  hookEvent(
    sessionIds: readonly string[],
    agent: HookAgent,
    payload: Record<string, unknown>,
  ): void {
    const event = payload['hook_event_name']
    if (typeof event !== 'string') return
    for (const sessionId of sessionIds) {
      const current = this.runtimes.get(sessionId)
      if (!current) continue
      this.hookSeenAt.set(sessionId, this.deps.now())
      this.retryBlocked.delete(sessionId) // hooks 开口了就回到常规：倒数那条路的例外撤销
      const next = this.applyHook(current, agent, event, payload)
      if (next && !isSameRuntime(current, next)) this.commit(next)
    }
  }

  private applyHook(
    current: SessionRuntime,
    agent: HookAgent,
    event: string,
    payload: Record<string, unknown>,
  ): SessionRuntime | null {
    const { pendingHint: _hint, ...bare } = current
    if (event === 'SessionStart') return { ...current, agent }
    if (event === 'SessionEnd') return { ...bare, agent: null, status: 'idle' }
    if (current.agent === null) return null
    return HOOK_CONTRACTS[agent].interpret(event, payload, current, {
      isViewed: this.viewedId === current.sessionId,
    })
  }

  /** 渲染进程上报正被查看的会话（不可见 / 失焦为 null）；「已完成未查看」一旦被查看即回空闲 */
  setViewed(sessionId: string | null): void {
    this.viewedId = sessionId
    const current = sessionId ? this.runtimes.get(sessionId) : undefined
    if (current?.status === 'done') this.commit({ ...current, status: 'idle' })
  }

  /** hooks 抑制窗：某会话收到 hooks 事件后 30 s 内，屏幕末尾启发式不产生状态转移（cwdNow 解析不受影响） */
  private isSuppressed(runtime: SessionRuntime): boolean {
    const seenAt = this.hookSeenAt.get(runtime.sessionId)
    return seenAt !== undefined && this.deps.now() - seenAt < HOOK_SUPPRESS_MS
  }

  /** 该会话是否正被查看（通知判定用） */
  isViewed(sessionId: string): boolean {
    return this.viewedId === sessionId
  }

  list(): SessionRuntime[] {
    return [...this.runtimes.values()].map((r) => ({ ...r }))
  }

  private remove(sessionId: string): void {
    this.hookSeenAt.delete(sessionId)
    this.elapsedSeen.delete(sessionId)
    this.countdownSeen.delete(sessionId)
    this.retryBlocked.delete(sessionId)
    if (!this.runtimes.delete(sessionId)) return
    this.deps.onRemove(sessionId)
  }

  private commit(runtime: SessionRuntime): void {
    if (runtime.status !== 'blocked') this.retryBlocked.delete(runtime.sessionId)
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
    a.pendingHint === b.pendingHint &&
    a.program === b.program
  )
}
