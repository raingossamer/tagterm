/**
 * xterm 实例池：一个会话一个终端实例，与 pty 同寿命；所有实例挂在同一容器里，
 * 各自一个绝对定位的 host，切换只切 display。禁止用一个实例反复重灌数据。
 */
import type { Session } from '@shared/models'
import type { TagTermApi, Unsubscribe } from '@shared/api'
import type {
  Disposable,
  TerminalFactory,
  TerminalInstance,
  TerminalSize,
} from './TerminalInstance'

const FALLBACK_SIZE: TerminalSize = { cols: 80, rows: 24 }

export interface TerminalPoolDeps {
  pty: TagTermApi['pty']
  createTerminal: TerminalFactory
  /** 下一帧调度（默认 requestAnimationFrame；测试传同步执行） */
  raf?: (fn: () => void) => void
}

interface Entry {
  term: TerminalInstance
  host: HTMLDivElement
  disposables: Disposable[]
}

export class TerminalPool {
  private readonly entries = new Map<string, Entry>()
  private container: HTMLElement | null = null
  private unsubscribes: Unsubscribe[] = []
  private activeId: string | null = null
  private readonly raf: (fn: () => void) => void

  constructor(private readonly deps: TerminalPoolDeps) {
    this.raf = deps.raf ?? ((fn) => requestAnimationFrame(() => fn()))
  }

  /** TerminalPane 挂载时调用：接管容器，并只订阅一次全局 onData / onExit */
  attach(container: HTMLElement): void {
    this.container = container
    for (const { host } of this.entries.values()) container.appendChild(host)
    this.unsubscribes.push(
      this.deps.pty.onData((sessionId, data) => this.entries.get(sessionId)?.term.write(data)),
      this.deps.pty.onExit((e) =>
        this.entries.get(e.sessionId)?.term.write(`\r\n[进程已退出，代码 ${e.exitCode}]\r\n`),
      ),
    )
  }

  detach(): void {
    for (const unsub of this.unsubscribes) unsub()
    this.unsubscribes = []
    this.container = null
  }

  /** 幂等：无实例 → 建实例 + open(host) + fit → pty.open；有实例不动 */
  async open(session: Session): Promise<void> {
    if (this.entries.has(session.id)) return
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.inset = '0'
    host.style.display = 'none'
    this.container?.appendChild(host)

    const term = this.deps.createTerminal()
    term.open(host)
    const disposables: Disposable[] = [
      term.onData((data) => this.deps.pty.write(session.id, data)),
      term.onResize((size) => void this.deps.pty.resize(session.id, size)),
    ]
    this.entries.set(session.id, { term, host, disposables })

    const size = term.fit() ?? FALLBACK_SIZE
    await this.deps.pty.open(session.id, size)
  }

  /** 其余 host 隐藏，目标显示；下一帧 fit + focus；WebGL 挪到该实例 */
  show(sessionId: string): void {
    const target = this.entries.get(sessionId)
    if (!target) return
    for (const [id, entry] of this.entries) {
      const isTarget = id === sessionId
      entry.host.style.display = isTarget ? 'block' : 'none'
      if (!isTarget) entry.term.setWebgl(false)
    }
    this.activeId = sessionId
    target.term.setWebgl(true)
    this.raf(() => {
      if (this.activeId !== sessionId) return
      target.term.fit()
      target.term.focus()
    })
  }

  /** 没有活动会话（空状态） */
  hide(): void {
    for (const entry of this.entries.values()) entry.host.style.display = 'none'
    this.activeId = null
  }

  /** ResizeObserver 回调：只 fit 可见实例（display:none 下量不到尺寸） */
  fitActive(): void {
    if (this.activeId) this.entries.get(this.activeId)?.term.fit()
  }

  focusActive(): void {
    if (this.activeId) this.entries.get(this.activeId)?.term.focus()
  }

  /** 移除会话 / 重启 shell 时：取消订阅、销毁实例、移除 host */
  dispose(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    for (const d of entry.disposables) d.dispose()
    entry.term.dispose()
    entry.host.remove()
    this.entries.delete(sessionId)
    if (this.activeId === sessionId) this.activeId = null
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  sessionIds(): string[] {
    return [...this.entries.keys()]
  }
}
