/**
 * 服务层（深模块）：主进程 agent 运行时子系统的唯一拥有者。从五路输入（pty 事件、进程树、hooks 载荷、屏幕末尾报告、
 * 正被查看）到三路输出（agent:status 广播、系统通知、角标）之间的全部因果都在这里，装配层只造适配器、接线一次。
 * 内部协作者：AgentDetector（状态机）、ProcessTreeProbe（进程树节拍）、HookServer（回环端点）、两个 HookInstaller（hooks 目标文件）。
 * 不 import electron；原生进程树以 listSubtree 注入，hooks 目标路径以 hookTargets 注入（测试指向临时目录）。
 */
import type { HookAgent, HooksStatus, HooksStatusMap, OutputReport } from '@shared/ipc'
import type { Session, SessionRuntime } from '@shared/models'
import type { PtyManagerDeps } from '../pty/PtyManager'
import { AgentDetector } from './AgentDetector'
import { HookInstaller, type HookTarget } from './HookInstaller'
import { matchSessionsByCwd } from './hookMatch'
import { derivePort } from './hookPort'
import { HookServer } from './HookServer'
import type { ProcessNode } from './processMatch'
import { ProcessTreeProbe } from './ProcessTreeProbe'

/** 进程树探针的缺省节拍：一次原生查询十几毫秒，2 s 一轮足够 */
const DEFAULT_PROBE_INTERVAL_MS = 2000

export interface AgentSubsystemOptions {
  /** 数据目录：hooks 端点的稳定端口由它哈希而来 */
  dataDir: string
  /** 会话列表：hooks 的 cwd 匹配与通知文案都要它（装配层传 () => store.list()） */
  sessions: () => readonly Session[]
  /** 广播 agent:status（记录删除时是一条 alive: false 的墓碑） */
  broadcast: (runtime: SessionRuntime) => void
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

  constructor(private readonly opts: AgentSubsystemOptions) {
    const now = opts.now ?? (() => Date.now())
    this.detector = new AgentDetector({
      now,
      onChange: (runtime) => opts.broadcast(runtime),
      onRemove: (sessionId) =>
        opts.broadcast({ sessionId, alive: false, agent: null, status: 'idle' }),
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
   * 把 PtyManager 的三个回调串上状态机与探针，调用方只写自己那份（广播 pty:data / pty:exit、isFile）。
   * 顺序固定：onData 先调用方再状态机；onExit 先调用方、再停探测、再删记录；onSpawn 先建记录、再开始探测、最后调用方
   */
  wrapPty(deps: PtyManagerDeps): PtyManagerDeps {
    return {
      ...deps,
      onData: (sessionId, data) => {
        deps.onData(sessionId, data)
        this.detector.ptyData(sessionId)
      },
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

  /** 渲染进程的静默末尾报告（≤ 8 行）：更新 cwdNow，有 agent 时判「等你确认」/「已完成」；未知会话忽略 */
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
    for (const [agent, installer] of Object.entries(this.installers)) {
      try {
        await installer.syncPort(this.hookPort)
      } catch (err) {
        console.warn(`[agent] 同步 ${agent} hooks 端口失败`, err)
      }
    }
  }

  /** 停探针、停端点 */
  async stop(): Promise<void> {
    this.probe.dispose()
    await this.hookServer.stop()
  }
}
