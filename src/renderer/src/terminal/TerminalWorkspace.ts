/**
 * 会话生命周期核心（纯 TS，不 import vue / pinia）：渲染进程里「一个会话从选中、打开终端、pty 退出、重启到移除」的唯一拥有者。
 * 拥有标签页集合与当前页、每会话运行态（opening / running / exited，渲染进程内「是否存活」只此一份）、
 * 何时打开 / 重启 / 销毁实例、何时显示哪个实例、键入是转发还是触发重启，以及对主进程会话列表与 pty 退出事件的反应。
 * xterm 一侧交给内部的 TerminalPool；主进程仍是 pty 真相源，这里只保留派生的镜像。
 * 观察方式：snapshot() 返回不可变快照，subscribe() 在每个命令结束时收到新快照。
 */
import type { Session } from '@shared/models'
import type { PtyExitEvent } from '@shared/ipc'
import type { TagTermApi, Unsubscribe } from '@shared/api'
import type { TerminalFactory } from './TerminalInstance'
import { TerminalPool } from './TerminalPool'

/** 每会话运行态：无记录 = 没有终端实例（从未打开，或已移除） */
export type PtyPhase = 'opening' | 'running' | 'exited'
export interface SessionRuntime {
  phase: PtyPhase
  exitCode?: number // exited 且由 pty:exit 触发时有值；open 失败导致的 exited 无值
}

/** 不可变快照：每次变化整体替换 */
export interface WorkspaceSnapshot {
  readonly openTabs: readonly string[]
  readonly activeId: string | null
  readonly runtime: Readonly<Record<string, SessionRuntime>>
}

/** pty 端口 = window.tagterm.pty 的结构子集；生产直接传 window.tagterm.pty，测试传剧本式 FakePty */
export type PtyPort = Pick<TagTermApi['pty'], 'open' | 'write' | 'resize' | 'onData' | 'onExit'>

export interface TerminalWorkspaceDeps {
  pty: PtyPort
  /** 终端端口：生产 createXtermFactory(...)，测试 FakeTerminal */
  createTerminal: TerminalFactory
  /** 下一帧调度：缺省 requestAnimationFrame，测试传同步执行 */
  raf?: (fn: () => void) => void
}

export class TerminalWorkspace {
  private readonly pool: TerminalPool
  private sessions = new Map<string, Session>()
  private openTabs: string[] = []
  private activeId: string | null = null
  private readonly runtime = new Map<string, SessionRuntime>()
  /** 每会话当前 pty 的 pid：退出事件靠它认领，避免上一条 pty 的退出误伤刚开好的终端 */
  private readonly pids = new Map<string, number>()
  /** 正在等 pty.open 返回的会话：此时还不知道新 pid，期间到达的退出事件先扣下 */
  private readonly opening = new Set<string>()
  private readonly deferredExits = new Map<string, PtyExitEvent>()
  private readonly listeners = new Set<(s: WorkspaceSnapshot) => void>()
  private readonly unsubscribes: Unsubscribe[]

  /** 构造即订阅 pty.onData / onExit（订阅不随 TerminalPane 挂载摇摆） */
  constructor(private readonly deps: TerminalWorkspaceDeps) {
    this.pool = new TerminalPool({
      createTerminal: deps.createTerminal,
      raf: deps.raf,
      onInput: (id, data) => this.handleInput(id, data),
      onResize: (id, size) => void deps.pty.resize(id, size),
    })
    this.unsubscribes = [
      deps.pty.onData((id, data) => this.pool.write(id, data)),
      deps.pty.onExit((e) => this.handleExit(e)),
    ]
  }

  /**
   * 入站事实：会话列表镜像（启动时与每次 session:changed 广播）。列表是 select 的存在性守卫；
   * 不在列表里的会话（本窗口移除或别处移除，都经主进程广播到达）→ 销毁实例 + 关其标签页 + 删运行态；幂等
   */
  syncSessions(sessions: readonly Session[]): void {
    this.sessions = new Map(sessions.map((s) => [s.id, s]))
    const gone = new Set(
      [...this.pool.sessionIds(), ...this.openTabs].filter((id) => !this.sessions.has(id)),
    )
    if (gone.size === 0) return
    for (const id of gone) this.evict(id)
    this.emit()
  }

  /** 选中：加标签页（若无）+ 激活 + 无实例则打开、已退出则重启 + 显示。未知 id 无副作用 */
  async select(id: string): Promise<void> {
    if (!this.sessions.has(id)) return
    if (!this.openTabs.includes(id)) this.openTabs.push(id)
    this.activeId = id
    // 已退出 → 重启：销毁旧实例后照常打开（新 spawn，旧输出不保留）
    if (this.runtime.get(id)?.phase === 'exited') this.pool.dispose(id)
    if (this.pool.has(id)) {
      this.pool.show(id)
      this.emit()
      return
    }
    // 先建实例并显示（空白终端立刻可见），再等主进程 spawn
    const size = this.pool.open(id)
    this.runtime.set(id, { phase: 'opening' })
    this.pool.show(id)
    this.emit()
    this.pids.delete(id)
    this.opening.add(id)
    try {
      const { pid } = await this.deps.pty.open(id, size)
      this.opening.delete(id)
      this.pids.set(id, pid)
      // 期间被移除（runtime 已删）则不再登记
      if (this.runtime.get(id)?.phase === 'opening') this.runtime.set(id, { phase: 'running' })
      // 等待期间到达的退出事件：是这条新 pty 自己退了才认，否则是上一条的迟到事件，丢弃
      const deferred = this.deferredExits.get(id)
      this.deferredExits.delete(id)
      if (deferred && deferred.pid === pid) this.handleExit(deferred)
    } catch (err) {
      // 实例保留并标记已退出：原因必须写进终端，否则界面上只剩一片空白（无提示符、无报错）；按回车或再次选中即重试
      const message = err instanceof Error ? err.message : String(err)
      this.opening.delete(id)
      this.deferredExits.delete(id)
      console.error('[terminal] 打开终端失败', err)
      if (this.pool.has(id)) {
        this.pool.write(id, `\r\n[打开终端失败：${message}]\r\n[按回车重试]\r\n`)
        this.runtime.set(id, { phase: 'exited' })
      }
    }
    this.emit()
  }

  /** 只动标签页：实例与 pty 都保留；关当前页激活 openTabs[min(i, len-1)]，全关则隐藏全部 */
  closeTab(id: string): void {
    if (!this.openTabs.includes(id)) return
    this.removeTab(id)
    this.emit()
  }

  /** 终端宿主（TerminalPane / SideHead） */
  attach(container: HTMLElement): void {
    this.pool.attach(container)
  }

  detach(): void {
    this.pool.detach()
  }

  fitActive(): void {
    this.pool.fitActive()
  }

  focusActive(): void {
    this.pool.focusActive()
  }

  snapshot(): WorkspaceSnapshot {
    return {
      openTabs: [...this.openTabs],
      activeId: this.activeId,
      runtime: Object.fromEntries([...this.runtime].map(([id, rt]) => [id, { ...rt }])),
    }
  }

  subscribe(listener: (s: WorkspaceSnapshot) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** App 卸载：退订 pty、销毁全部实例、清空记录 */
  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    for (const id of this.pool.sessionIds()) this.pool.dispose(id)
    this.runtime.clear()
    this.pids.clear()
    this.opening.clear()
    this.deferredExits.clear()
    this.openTabs = []
    this.activeId = null
  }

  /** 键入：运行中（含打开中）转发；已退出吞掉按键，回车即重启 */
  private handleInput(id: string, data: string): void {
    if (this.runtime.get(id)?.phase === 'exited') {
      if (data.includes('\r')) void this.select(id)
      return
    }
    this.deps.pty.write(id, data)
  }

  /** 会话已不存在：销毁实例、删运行态、关其标签页（邻居规则） */
  private evict(id: string): void {
    this.pool.dispose(id)
    this.runtime.delete(id)
    this.pids.delete(id)
    this.opening.delete(id)
    this.deferredExits.delete(id)
    this.removeTab(id)
  }

  /** 从标签页移除；若是当前页则激活 min(i, len-1) 位置的邻居并同步显示 */
  private removeTab(id: string): void {
    const i = this.openTabs.indexOf(id)
    if (i < 0) return
    this.openTabs.splice(i, 1)
    if (this.activeId === id) {
      this.activeId = this.openTabs[Math.min(i, this.openTabs.length - 1)] ?? null
      this.syncDisplay()
    }
  }

  /**
   * pty 退出：实例末尾写提示，运行态记为已退出（按键从此不再转发）。
   * 只认当前那条 pty 的退出：重开会话时上一条 pty 的退出事件可能迟到，若照单全收会把刚开好的
   * 终端标成 exited —— 界面上就是「打字没反应」的假死（只有回车能救）。
   */
  private handleExit(e: PtyExitEvent): void {
    // 正在等 pty.open 返回：还不知道新 pid，先扣下，等 open 拿到 pid 再判定归属
    if (this.opening.has(e.sessionId)) {
      this.deferredExits.set(e.sessionId, e)
      return
    }
    const current = this.pids.get(e.sessionId)
    if (current !== undefined && current !== e.pid) return // 上一条 pty 的迟到退出
    if (!this.pool.has(e.sessionId)) return
    this.pool.write(e.sessionId, `\r\n[进程已退出，代码 ${e.exitCode}]\r\n`)
    this.runtime.set(e.sessionId, { phase: 'exited', exitCode: e.exitCode })
    this.emit()
  }

  /** 当前页变化后统一同步显示：有当前页且有实例则显示它，否则隐藏全部（空状态） */
  private syncDisplay(): void {
    if (this.activeId && this.pool.has(this.activeId)) this.pool.show(this.activeId)
    else this.pool.hide()
  }

  private emit(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.snapshot()
    for (const listener of [...this.listeners]) listener(snapshot)
  }
}
