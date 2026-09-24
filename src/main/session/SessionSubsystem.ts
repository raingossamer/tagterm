/**
 * 服务层（深模块）：主进程里「一个会话」跨服务的编排 —— 会话记录（SessionStore）、会话 ↔ 标签关联（TagStore）、
 * 终端进程（PtyManager）与运行时记录（AgentSubsystem）之间的因果都在这里；接口层与烟测只经它动会话与终端。
 * 不持有状态：真相仍在两个 store、PtyManager 与 AgentDetector。不 import electron：打开目录以命名端口 FolderPort 注入。
 * 标签本身的增删改是单文件操作，不经这里（接口层直连 TagStore）。
 */
import type { OutputReport, PtyOpenResult, PtySize } from '@shared/ipc'
import type { Session } from '@shared/models'
import type { AgentSubsystem } from '../agent/AgentSubsystem'
import type { PtyManager } from '../pty/PtyManager'
import type { SessionStore } from '../store/SessionStore'
import type { TagStore } from '../store/TagStore'

/** 终端进程：PtyManager 的结构子集（生产即经 AgentSubsystem.wrapPty 接好线的那一个 PtyManager） */
export type TerminalPort = Pick<
  PtyManager,
  'spawn' | 'has' | 'getPid' | 'write' | 'resize' | 'kill' | 'killAndWait'
>

/** 运行时记录：AgentSubsystem 的结构子集（空闲核对、移除即清、当前目录、屏幕报告） */
export type AgentRuntimePort = Pick<
  AgentSubsystem,
  'isShellIdle' | 'sessionRemoved' | 'list' | 'reportOutput'
>

/** 在资源管理器打开一个目录（Electron 能力的命名端口）：打开了为 null，打不开返回原因 */
export interface FolderPort {
  open(path: string): Promise<string | null>
}

export interface SessionSubsystemDeps {
  store: SessionStore
  tags: TagStore
  terminals: TerminalPort
  agent: AgentRuntimePort
  folders: FolderPort
}

export class SessionSubsystem {
  constructor(private readonly deps: SessionSubsystemDeps) {}

  /**
   * 启动加载：sessions.json → tags.json → 清掉指向不存在会话或标签的关联（崩溃遗留；落盘、不广播 ——
   * 此时渲染进程还没订阅）。坏文件原样抛（带路径），由装配层弹框退出
   */
  async load(): Promise<void> {
    await this.deps.store.load()
    await this.deps.tags.load()
    await this.deps.tags.pruneDangling(this.deps.store.list().map((s) => s.id))
  }

  /**
   * 打开会话的终端（幂等）：没在跑就按记录的目录与 shell 起一个（created: true），在跑就复用。
   * 只读会话记录，不写盘、不广播；会话不存在抛「会话不存在：<id>」
   */
  openTerminal(id: string, size: PtySize): PtyOpenResult {
    const session = this.deps.store.get(id)
    const running = this.deps.terminals.getPid(id)
    if (running !== null) return { created: false, pid: running }
    const { pid } = this.deps.terminals.spawn(id, {
      cwd: session.cwd,
      shell: session.shell,
      cols: size.cols,
      rows: size.rows,
    })
    return { created: true, pid }
  }

  /**
   * 渲染进程的屏幕末尾报告：会话记录还在才交给运行时（更新当前目录、判「运行中」等），否则静默丢弃 ——
   * 记录删掉之后、pty 退出之前，运行时记录可能还在，不能再被报告推动
   */
  reportOutput(id: string, report: OutputReport): void {
    if (!this.hasSession(id)) return
    this.deps.agent.reportOutput(id, report)
  }

  // ---- 一行转发：换「接口层与烟测只有这一扇门通到会话与终端」 ----

  list(): Session[] {
    return this.deps.store.list()
  }

  /** 整体重排；排列合法性由 SessionStore 判定（只有它认识全部会话） */
  reorder(ids: readonly string[]): Promise<void> {
    return this.deps.store.reorder(ids)
  }

  /** 终端没在跑时静默忽略（渲染进程可能在 pty 退出后仍发按键） */
  writeTerminal(id: string, data: string): void {
    this.deps.terminals.write(id, data)
  }

  resizeTerminal(id: string, size: PtySize): void {
    this.deps.terminals.resize(id, size.cols, size.rows)
  }

  /** 结束会话的终端，等进程真正退出（pty:exit 先广播出去）才 resolve；没在跑立即 resolve —— 右键「重启终端」靠它 */
  killTerminal(id: string): Promise<void> {
    return this.deps.terminals.killAndWait(id)
  }

  isTerminalAlive(id: string): boolean {
    return this.deps.terminals.has(id)
  }

  private hasSession(id: string): boolean {
    return this.deps.store.list().some((s) => s.id === id)
  }
}
