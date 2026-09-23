/**
 * 服务层（深模块）：主进程 agent 运行时子系统的唯一拥有者。从五路输入（pty 事件、进程树、hooks 载荷、屏幕末尾报告、
 * 正被查看）到三路输出（agent:status 广播、系统通知、角标）之间的全部因果都在这里，装配层只造适配器、接线一次。
 * 内部协作者：AgentDetector（状态机）、ProcessTreeProbe（进程树节拍）、HookServer（回环端点）、两个 HookInstaller（hooks 目标文件）。
 * 不 import electron：原生进程树以 listSubtree 注入，hooks 目标路径以 hookTargets 注入（测试指向临时目录），
 * 系统通知与角标以两个命名端口注入（生产 platform/agentPorts.ts 的 Electron 适配器，测试记录数组）。
 * 文件末尾是本模块的内部纯函数：端口派生、cwd 匹配、通知判定。
 */
import type { HookAgent, HooksStatus, HooksStatusMap, OutputReport } from '@shared/ipc'
import type { AgentKind, AgentStatus, Session, SessionRuntime } from '@shared/models'
import type { PtyManagerDeps } from '../pty/PtyManager'
import { AgentDetector } from './AgentDetector'
import { HookInstaller, type HookTarget } from './HookInstaller'
import { HookServer } from './HookServer'
import type { ProcessNode } from './processMatch'
import { ProcessTreeProbe } from './ProcessTreeProbe'

/** 进程树探针的缺省节拍：一次原生查询十几毫秒，2 s 一轮足够 */
const DEFAULT_PROBE_INTERVAL_MS = 2000
/** hooks 端点的稳定端口范围（IANA 动态端口段） */
const HOOK_PORT_MIN = 49152
const HOOK_PORT_MAX = 65535

/** 系统通知的文案 */
export interface NotificationText {
  title: string
  body: string
}

/** 系统通知端口：Electron Notification 的最小面；点击后「显示窗口 + 广播 app:select-session」由生产适配器做 */
export interface NotificationPort {
  isSupported(): boolean
  show(sessionId: string, text: NotificationText): void
}

/** 角标要表达的三个会话计数 */
export interface BadgeCounts {
  blocked: number
  working: number
  done: number
}

/**
 * 角标端口：托盘图标 + 任务栏 overlay 合成「等你确认 / 已完成 / 运行中」三个计数；
 * 适配器按 等你确认（黄）> 已完成（蓝）> 运行中（绿）> 原图标 选图，都为 0 还原 —— 蓝优先于绿是提醒人去给跑完的终端发下一轮任务
 */
export interface BadgePort {
  setCounts(counts: BadgeCounts): void
}

export interface AgentSubsystemOptions {
  /** 数据目录：hooks 端点的稳定端口由它哈希而来 */
  dataDir: string
  /** 会话列表：hooks 的 cwd 匹配与通知文案都要它（装配层传 () => store.list()） */
  sessions: () => readonly Session[]
  /** 广播 agent:status（记录删除时是一条 alive: false 的墓碑） */
  broadcast: (runtime: SessionRuntime) => void
  notifications: NotificationPort
  badge: BadgePort
  /** 两个 hooks 目标文件；测试指向临时目录，永不碰真实 ~/.claude / ~/.codex */
  hookTargets: Record<HookAgent, HookTarget>
  /** 某 pid 的全部后代进程（装配层传 windowsProcessTree.listSubtree，测试传假子树） */
  listSubtree: (pid: number) => Promise<ProcessNode[]>
  now?: () => number
  probeIntervalMs?: number
  /** 探针定时器（测试注入手动触发的假定时器） */
  timers?: {
    setTimer: (fn: () => void, ms: number) => unknown
    clearTimer: (handle: unknown) => void
  }
  /** 缺省 derivePort(dataDir)；测试传 0 = 随机端口 */
  preferredPort?: number
  /** 首选端口被占时最多试几个（测试用 1 构造「全部失败」） */
  maxPortAttempts?: number
}

export class AgentSubsystem {
  private readonly detector: AgentDetector
  private readonly probe: ProcessTreeProbe
  private readonly hookServer: HookServer
  private readonly installers: Record<HookAgent, HookInstaller>
  /** HookServer 实际监听的端口；未 start 或启动失败为 0 */
  private hookPort = 0
  /** 每会话上次记录变化时的状态：同会话同状态只弹一次通知，记录删除时清 */
  private readonly lastNotifiedStatus = new Map<string, AgentStatus>()
  /** 上次交给角标端口的三个计数：都没变不重复设置 */
  private lastCounts: BadgeCounts = { blocked: 0, working: 0, done: 0 }

  constructor(private readonly opts: AgentSubsystemOptions) {
    const now = opts.now ?? (() => Date.now())
    this.detector = new AgentDetector({
      now,
      onChange: (runtime) => {
        opts.broadcast(runtime)
        this.notifyOnChange(runtime)
        this.refreshBadge()
      },
      onRemove: (sessionId) => {
        opts.broadcast({ sessionId, alive: false, agent: null, status: 'idle' })
        this.lastNotifiedStatus.delete(sessionId)
        this.refreshBadge()
      },
    })
    this.probe = new ProcessTreeProbe({
      listSubtree: opts.listSubtree,
      intervalMs: opts.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS,
      ...opts.timers,
    })
    this.probe.onSnapshot((snapshot) => this.detector.processSnapshot(snapshot))
    // hooks 载荷按 cwd 映射到会话（多命中优先 agent 已是该工具的会话），零命中静默丢弃
    this.hookServer = new HookServer({
      onHook: (agent, payload) => {
        const ids = matchSessionsByCwd(payload['cwd'], opts.sessions(), this.detector.list(), agent)
        if (ids.length > 0) this.detector.hookEvent(ids, agent, payload)
      },
      ...(opts.maxPortAttempts !== undefined ? { maxPortAttempts: opts.maxPortAttempts } : {}),
    })
    this.installers = {
      claude: new HookInstaller(opts.hookTargets.claude, { now }),
      codex: new HookInstaller(opts.hookTargets.codex, { now }),
    }
  }

  /**
   * 把 PtyManager 的 spawn / exit 回调串上状态机与探针，调用方只写自己那份（广播 pty:data / pty:exit、isFile）。
   * onData 原样透传：「有输出到达」不是状态信号（启动画面 / 打字 / 重绘都有输出，见 AgentDetector）。
   * 顺序固定：onExit 先调用方、再停探测、再删记录；onSpawn 先建记录、再开始探测、最后调用方
   */
  wrapPty(deps: PtyManagerDeps): PtyManagerDeps {
    return {
      ...deps,
      onExit: (e) => {
        deps.onExit(e)
        this.probe.unwatch(e.sessionId)
        this.detector.ptyExited(e.sessionId)
      },
      onSpawn: (sessionId, pid) => {
        this.detector.ptySpawned(sessionId)
        this.probe.watch(sessionId, pid)
        deps.onSpawn?.(sessionId, pid)
      },
    }
  }

  list(): SessionRuntime[] {
    return this.detector.list()
  }

  /** 渲染进程上报正被查看的会话（不可见 / 失焦为 null）；「已完成未查看」一旦被查看即回空闲 */
  setViewed(sessionId: string | null): void {
    this.detector.setViewed(sessionId)
  }

  /** 渲染进程的屏幕末尾报告（屏幕在动时每秒一次 silentMs 0、静默 1.5 s 后一次，≤ 24 行）：更新 cwdNow，有 agent 时判「运行中」/「等你确认」/「已完成」；未知会话忽略 */
  reportOutput(sessionId: string, report: OutputReport): void {
    this.detector.reportOutput(sessionId, report)
  }

  /** 会话被移除（没开过终端的会话只能靠这里清记录） */
  sessionRemoved(sessionId: string): void {
    this.detector.sessionRemoved(sessionId)
  }

  /**
   * shell 是否空闲（session:update 改目录 / Shell 前的核对）：没有任何子进程即空闲。
   * 查询抛错说明 pid 已不存在（pty 恰好退出），同样按空闲处理，不把原生错误抛给用户
   */
  async isShellIdle(pid: number): Promise<boolean> {
    try {
      return !(await this.probe.hasChildren(pid))
    } catch {
      return true
    }
  }

  /** HookServer 实际监听的端口；未 start 或启动失败为 0 */
  get port(): number {
    return this.hookPort
  }

  /** 两个目标的 hooks 安装状态（已安装的报文件里写的端口） */
  hooksStatus(): Promise<HooksStatusMap> {
    return Promise.all([
      this.installers.claude.status(this.hookPort),
      this.installers.codex.status(this.hookPort),
    ]).then(([claude, codex]) => ({ claude, codex }))
  }

  /** 设置「Agent」段的开关：安装 / 卸载某目标的 hooks，返回该目标的状态；失败 reject 中文 message */
  setHooks(agent: HookAgent, enabled: boolean): Promise<HooksStatus> {
    const installer = this.installers[agent]
    return enabled ? installer.install(this.hookPort) : installer.uninstall(this.hookPort)
  }

  /**
   * 应用就绪即调用（不论 hooks 是否安装）：起回环端点，首选端口由数据目录哈希而来、被占则顺延；
   * 启动失败只记日志、端口保持 0、不抛（应用照常跑，hooks 不可用）；端口 > 0 才对已安装的目标静默改写端口
   */
  async start(): Promise<void> {
    try {
      this.hookPort = await this.hookServer.start(
        this.opts.preferredPort ?? derivePort(this.opts.dataDir),
      )
      console.log(`[agent] hooks 端点已启动 http://127.0.0.1:${this.hookPort}/tagterm/hook/`)
    } catch (err) {
      console.error('[agent] hooks 端点启动失败，Claude / Codex hooks 不可用', err)
      return
    }
    // 启动补装：已装 hooks 的目标按当前版本整体重建我们的条目（补新事件、升级旧命令、换成本次端口）；没装的不碰
    for (const [agent, installer] of Object.entries(this.installers)) {
      try {
        if (await installer.refresh(this.hookPort))
          console.log(`[agent] ${agent} hooks 已按当前版本更新`)
      } catch (err) {
        console.warn(`[agent] 更新 ${agent} hooks 失败，文件未改动`, err)
      }
    }
  }

  /** 停探针、停端点 */
  async stop(): Promise<void> {
    this.probe.dispose()
    await this.hookServer.stop()
  }

  /** 进入 blocked（没人看）/ done → 系统通知；同会话同状态只弹一次（离开后再进入再弹）；通知中心不可用不弹 */
  private notifyOnChange(runtime: SessionRuntime): void {
    const prev = this.lastNotifiedStatus.get(runtime.sessionId) ?? null
    this.lastNotifiedStatus.set(runtime.sessionId, runtime.status)
    const text = decideNotification(
      prev,
      runtime,
      this.detector.isViewed(runtime.sessionId),
      this.sessionNameOf(runtime.sessionId),
    )
    if (!text || !this.opts.notifications.isSupported()) return
    this.opts.notifications.show(runtime.sessionId, text)
  }

  /** 角标 = { 等你确认, 运行中, 已完成 } 三个会话计数：托盘图标与任务栏 overlay 由端口合成；三个都没变不重复设置 */
  private refreshBadge(): void {
    const runtimes = this.detector.list()
    const countOf = (status: AgentStatus): number =>
      runtimes.filter((r) => r.status === status).length
    const counts: BadgeCounts = {
      blocked: countOf('blocked'),
      working: countOf('working'),
      done: countOf('done'),
    }
    const last = this.lastCounts
    if (
      counts.blocked === last.blocked &&
      counts.working === last.working &&
      counts.done === last.done
    ) {
      return
    }
    this.lastCounts = counts
    this.opts.badge.setCounts(counts)
  }

  /** 通知文案用会话名；会话已不在列表里时退回 id */
  private sessionNameOf(sessionId: string): string {
    return this.opts.sessions().find((s) => s.id === sessionId)?.name ?? sessionId
  }
}

// ---- 内部纯函数 ----

/**
 * 数据目录路径 → 稳定端口（FNV-1a 32 位，落在 49152–65535）：端口稳定，hooks 配置文件里写死的 URL 才不用每次启动都改；
 * 输入按小写、统一正斜杠归一，同一目录的两种写法得到同一端口。被占用时 HookServer 自己 +1 顺延。导出只为直接断言派生规则
 */
export function derivePort(dataDir: string): number {
  const key = dataDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return HOOK_PORT_MIN + (hash % (HOOK_PORT_MAX - HOOK_PORT_MIN + 1))
}

/** hook 载荷里的 cwd 归一化：小写、统一反斜杠、去掉尾分隔符 */
function normalizeCwd(cwd: string): string {
  return cwd.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * hook 载荷的 cwd → 会话：归一化后与 session.cwd 或运行时 cwdNow 比较；
 * 多个命中时优先 agent 已是目标工具的会话，仍歧义则全部返回（启动后进程树首轮前可能标两个会话，可接受），零命中空数组
 */
function matchSessionsByCwd(
  cwd: unknown,
  sessions: readonly Session[],
  runtimes: readonly SessionRuntime[],
  preferAgent?: AgentKind,
): string[] {
  if (typeof cwd !== 'string' || !cwd) return []
  const target = normalizeCwd(cwd)
  const runtimeOf = new Map(runtimes.map((r) => [r.sessionId, r]))
  const hits = sessions.filter((s) => {
    if (normalizeCwd(s.cwd) === target) return true
    const cwdNow = runtimeOf.get(s.id)?.cwdNow
    return cwdNow !== undefined && normalizeCwd(cwdNow) === target
  })
  if (hits.length > 1 && preferAgent) {
    const preferred = hits.filter((s) => runtimeOf.get(s.id)?.agent === preferAgent)
    if (preferred.length > 0) return preferred.map((s) => s.id)
  }
  return hits.map((s) => s.id)
}

/**
 * 某会话状态变化要不要弹通知、弹什么：进入 blocked 且不是正被查看 → 「<会话名> 等你确认」（正文 = 那一行提示）；
 * 进入 done → 「<会话名> 完成」（done 定义上就是没人看）；同一状态重复变化不重复弹（prev 相同即跳过），离开后再进入再弹
 */
function decideNotification(
  prevStatus: AgentStatus | null,
  next: SessionRuntime,
  isViewed: boolean,
  sessionName: string,
): NotificationText | null {
  if (prevStatus === next.status) return null
  if (next.status === 'blocked') {
    return isViewed ? null : { title: `${sessionName} 等你确认`, body: next.pendingHint ?? '' }
  }
  if (next.status === 'done') return { title: `${sessionName} 完成`, body: '' }
  return null
}
