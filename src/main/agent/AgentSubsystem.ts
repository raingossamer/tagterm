/**
 * 服务层（深模块）：主进程 agent 运行时子系统的唯一拥有者。从五路输入（pty 事件、进程树、hooks 载荷、屏幕末尾报告、
 * 正被查看）到三路输出（agent:status 广播、系统通知、角标）之间的全部因果都在这里，装配层只造适配器、接线一次。
 * 内部协作者：AgentDetector（状态机）、ProcessTreeProbe（进程树节拍）。不 import electron；原生进程树以 listSubtree 注入。
 */
import type { OutputReport } from '@shared/ipc'
import type { Session, SessionRuntime } from '@shared/models'
import type { PtyManagerDeps } from '../pty/PtyManager'
import { AgentDetector } from './AgentDetector'
import type { ProcessNode } from './processMatch'
import { ProcessTreeProbe } from './ProcessTreeProbe'

/** 进程树探针的缺省节拍：一次原生查询十几毫秒，2 s 一轮足够 */
const DEFAULT_PROBE_INTERVAL_MS = 2000

export interface AgentSubsystemOptions {
  /** 会话列表：hooks 的 cwd 匹配与通知文案都要它（装配层传 () => store.list()） */
  sessions: () => readonly Session[]
  /** 广播 agent:status（记录删除时是一条 alive: false 的墓碑） */
  broadcast: (runtime: SessionRuntime) => void
  /** 某 pid 的全部后代进程（装配层传 windowsProcessTree.listSubtree，测试传假子树） */
  listSubtree: (pid: number) => Promise<ProcessNode[]>
  now?: () => number
  probeIntervalMs?: number
  /** 探针定时器（测试注入手动触发的假定时器） */
  timers?: {
    setTimer: (fn: () => void, ms: number) => unknown
    clearTimer: (handle: unknown) => void
  }
}

export class AgentSubsystem {
  private readonly detector: AgentDetector
  private readonly probe: ProcessTreeProbe

  constructor(opts: AgentSubsystemOptions) {
    this.detector = new AgentDetector({
      now: opts.now ?? (() => Date.now()),
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

  /** 停探针 */
  stop(): void {
    this.probe.dispose()
  }
}
