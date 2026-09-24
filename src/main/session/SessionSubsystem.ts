/**
 * 服务层（深模块）：主进程里「一个会话」跨服务的编排 —— 会话记录（SessionStore）、会话 ↔ 标签关联（TagStore）、
 * 终端进程（PtyManager）与运行时记录（AgentSubsystem）之间的因果都在这里；接口层与烟测只经它动会话与终端。
 * 不持有状态：真相仍在两个 store、PtyManager 与 AgentDetector。不 import electron：打开目录以命名端口 FolderPort 注入。
 * 标签本身的增删改是单文件操作，不经这里（接口层直连 TagStore）。
 */
import type {
  CreateSessionInput,
  OutputReport,
  PtyOpenResult,
  PtySize,
  SessionPatch,
} from '@shared/ipc'
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
   * 新建会话：先建记录（广播 session:changed），再按 tagIds 顺序逐个挂标签（各写各播）。
   * 跨两份文件不做事务：挂标签失败（如标签不存在）原样抛，已建的会话与已挂上的关联不回滚
   */
  async create(input: CreateSessionInput): Promise<Session> {
    const { tagIds = [], ...fields } = input
    const session = await this.deps.store.create(fields)
    for (const tagId of tagIds) await this.deps.tags.attach(session.id, tagId)
    return session
  }

  /**
   * 改名 / 换目录 / 换 shell。目录或 shell 真的变了（同值不算）且终端在跑时：shell 下有程序在跑即拒绝、什么都不动；
   * 空闲则先结束终端并等它真正退出（pty:exit 先广播出去）再写记录 —— 渲染进程拿到结果时运行态已是 exited，
   * 再选中即按新配置重开。只改名不查进程树、不动终端
   */
  async update(id: string, patch: SessionPatch): Promise<Session> {
    const current = this.deps.store.get(id)
    const isConfigChanged =
      (patch.cwd !== undefined && patch.cwd !== current.cwd) ||
      (patch.shell !== undefined && patch.shell !== current.shell)
    const pid = this.deps.terminals.getPid(id)
    if (isConfigChanged && pid !== null) {
      if (!(await this.deps.agent.isShellIdle(pid))) {
        throw new Error('终端里有程序正在运行，退出后再修改目录或 Shell')
      }
      await this.deps.terminals.killAndWait(id)
    }
    return this.deps.store.update(id, patch)
  }

  /**
   * 移除会话，四步有序：结束终端（不等退出）→ 删记录（广播 session:changed）→ 删其关联（有才写，广播 tag:changed）
   * → 立即清掉运行时记录并广播墓碑（不等 pty 退出；没开过终端的会话没有记录，调用无副作用）。
   * 跨两份文件不做事务：中途写盘失败原样抛、已做的不回滚，残留关联由下次 load 清掉
   */
  async remove(id: string): Promise<void> {
    this.deps.terminals.kill(id)
    await this.deps.store.remove(id)
    await this.deps.tags.detachAllOf(id)
    this.deps.agent.sessionRemoved(id)
  }

  /** 给会话挂标签（幂等）：先核对会话存在（TagStore 不认识会话），标签不存在由 TagStore 抛 */
  async attachTag(sessionId: string, tagId: string): Promise<void> {
    this.deps.store.get(sessionId)
    await this.deps.tags.attach(sessionId, tagId)
  }

  /** 从会话摘标签：不核对会话（摘不存在的关联本来就静默），与挂标签的不对称是有意的 */
  detachTag(sessionId: string, tagId: string): Promise<void> {
    return this.deps.tags.detach(sessionId, tagId)
  }

  /**
   * 在资源管理器打开会话的当前目录：路径从真相源解析（运行时 cwdNow 优先，缺省记录的固定目录），
   * 渲染进程只传会话 id、拿不到「打开任意路径」的能力；打不开抛「打不开目录：<原因>」
   */
  async openDirectory(id: string): Promise<void> {
    const session = this.deps.store.get(id)
    const cwdNow = this.deps.agent.list().find((r) => r.sessionId === id)?.cwdNow
    const error = await this.deps.folders.open(cwdNow ?? session.cwd)
    if (error) throw new Error(`打不开目录：${error}`)
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
