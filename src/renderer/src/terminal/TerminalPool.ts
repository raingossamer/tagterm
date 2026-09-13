/**
 * xterm 实例池：一个会话一个终端实例，所有实例挂在同一容器里，各自一个绝对定位的 host，切换只切 display。
 * 只管 xterm 一侧（实例 / host / 显示 / WebGL / fit / focus），不认识 pty：键入与重排经 onInput / onResize 交上层裁决。
 * 禁止用一个实例反复重灌数据。
 */
import type {
  Disposable,
  TerminalFactory,
  TerminalInstance,
  TerminalSize,
} from './TerminalInstance'

const FALLBACK_SIZE: TerminalSize = { cols: 80, rows: 24 }

export interface TerminalPoolDeps {
  createTerminal: TerminalFactory
  /** 下一帧调度（默认 requestAnimationFrame；测试传同步执行） */
  raf?: (fn: () => void) => void
  /** 用户在某实例里键入：转发 pty 还是触发重启由上层决定 */
  onInput: (sessionId: string, data: string) => void
  /** 某实例重排后的新尺寸：上层据此同步 pty */
  onResize: (sessionId: string, size: TerminalSize) => void
}

interface Entry {
  term: TerminalInstance
  host: HTMLDivElement
  disposables: Disposable[]
  size: TerminalSize
}

export class TerminalPool {
  private readonly entries = new Map<string, Entry>()
  private container: HTMLElement | null = null
  private activeId: string | null = null
  private readonly raf: (fn: () => void) => void

  constructor(private readonly deps: TerminalPoolDeps) {
    this.raf = deps.raf ?? ((fn) => requestAnimationFrame(() => fn()))
  }

  /** TerminalPane 挂载时调用：接管容器并补挂已建的 host */
  attach(container: HTMLElement): void {
    this.container = container
    for (const { host } of this.entries.values()) container.appendChild(host)
  }

  detach(): void {
    this.container = null
  }

  /** 幂等：无实例 → 建 host（隐藏）+ 实例 + fit；有实例返回上次尺寸。宿主量不到尺寸时回退 80×24 */
  open(sessionId: string): TerminalSize {
    const existing = this.entries.get(sessionId)
    if (existing) return existing.size
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.inset = '0'
    host.style.display = 'none'
    this.container?.appendChild(host)

    const term = this.deps.createTerminal()
    term.open(host)
    const entry: Entry = { term, host, disposables: [], size: FALLBACK_SIZE }
    entry.disposables.push(
      term.onData((data) => this.deps.onInput(sessionId, data)),
      term.onResize((size) => {
        entry.size = size
        this.deps.onResize(sessionId, size)
      }),
    )
    this.entries.set(sessionId, entry)
    entry.size = term.fit() ?? FALLBACK_SIZE
    return entry.size
  }

  /** 主进程输出写入对应实例；未知会话忽略 */
  write(sessionId: string, data: string): void {
    this.entries.get(sessionId)?.term.write(data)
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
      if (this.container) target.term.fit() // 未接管容器时 host 不在 DOM 里，量不到尺寸
      target.term.focus()
    })
  }

  /** 没有活动会话（空状态） */
  hide(): void {
    for (const entry of this.entries.values()) entry.host.style.display = 'none'
    this.activeId = null
  }

  /** ResizeObserver 回调：只 fit 可见实例（display:none 下量不到尺寸）；未接管容器时不 fit */
  fitActive(): void {
    if (this.container && this.activeId) this.entries.get(this.activeId)?.term.fit()
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
