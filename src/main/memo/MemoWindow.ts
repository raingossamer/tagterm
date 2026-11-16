/**
 * 服务层：本周备忘小窗（memo-floating-window 决策 2 / 3）。不 import electron —— 窗口经 MemoWindowPort 注入。
 * - 第一次打开才建窗口（从没打开过就不占内存），关掉只隐藏，之后复用；
 * - 热键按 { 开没开, 有没有焦点 } 打开 / 只聚焦 / 关掉（decideMemoToggle），左栏按钮开关，托盘打开并聚焦，启动时不抢焦点地打开；
 * - 只管小窗，不碰主窗口；
 * - 位置与大小记在数据目录的 memo-window.json：拖动 / 拉伸结束与关掉时写，打开时按 placeMemoWindow 放（越界挪回）；
 *   文件坏了只是窗口位置丢了，用默认位置并记 [memo] 警告，不抛。
 */
import { join } from 'node:path'
import type { EventArgs, EventChannel } from '@shared/ipc'
import { readJson, writeJsonAtomic } from '../store/jsonFile'
import { createSerialQueue } from '../store/serialQueue'
import { decideMemoToggle, type MemoAction } from '../shortcut/memoToggle'
import {
  MEMO_WINDOW_FILE_VERSION,
  parseMemoWindowFile,
  placeMemoWindow,
  type MemoWindowFile,
  type Rect,
} from './memoWindowBounds'

const MEMO_WINDOW_FILE = 'memo-window.json'

/** 一个已建好的小窗（平台层包 BrowserWindow） */
export interface MemoWindowHandle {
  isVisible(): boolean
  isFocused(): boolean
  /** 显示并激活 */
  show(): void
  /** 显示但不激活（启动时打开） */
  showInactive(): void
  focus(): void
  hide(): void
  getBounds(): Rect
  send<K extends EventChannel>(channel: K, ...args: EventArgs<K>): void
}

export interface MemoWindowEvents {
  /** 拖动 / 拉伸结束 */
  onBoundsChanged(): void
  /** 系统的关闭请求（Alt+F4 等）：由服务决定只隐藏 */
  onCloseRequest(): void
}

export interface MemoWindowPort {
  create(bounds: Rect, events: MemoWindowEvents): MemoWindowHandle
  /** 全部屏幕的工作区 */
  workAreas(): Rect[]
  /** 主窗口所在屏幕的工作区（没有主窗口时主屏） */
  mainArea(): Rect
}

export interface MemoWindowDeps {
  port: MemoWindowPort
  dataDir: string
}

export class MemoWindow {
  private readonly port: MemoWindowPort
  private readonly file: string
  private readonly queue = createSerialQueue()
  private saved: Rect | null = null
  private win: MemoWindowHandle | null = null

  constructor(deps: MemoWindowDeps) {
    this.port = deps.port
    this.file = join(deps.dataDir, MEMO_WINDOW_FILE)
  }

  /** 读记住的位置；缺失 → 没记过；坏了 → 记警告、当没记过 */
  async load(): Promise<void> {
    let raw: unknown
    try {
      raw = await readJson(this.file)
    } catch (err) {
      console.warn(`[memo] 备忘小窗的位置文件读不出来，改用默认位置：${(err as Error).message}`)
      return
    }
    if (raw === null) return
    this.saved = parseMemoWindowFile(raw)
    if (!this.saved) console.warn(`[memo] 备忘小窗的位置文件格式不认识，改用默认位置：${this.file}`)
  }

  isOpen(): boolean {
    return this.win?.isVisible() ?? false
  }

  /** 全局热键 */
  press(): MemoAction {
    const action = decideMemoToggle({
      isOpen: this.isOpen(),
      isFocused: this.win?.isFocused() ?? false,
    })
    if (action === 'close') this.close()
    else this.open()
    return action
  }

  /** 左栏按钮：没开就打开（并聚焦），开着就关掉，不看焦点 */
  toggle(): void {
    if (this.isOpen()) this.close()
    else this.open()
  }

  /** 打开（托盘、热键、左栏）；focus: false = 显示但不抢焦点（启动时打开）。已开着就只聚焦 */
  open(options: { focus?: boolean } = {}): void {
    const focus = options.focus ?? true
    const existed = this.win !== null
    const win = this.ensureWindow()
    if (!focus) {
      if (!win.isVisible()) win.showInactive()
      return
    }
    if (win.isVisible()) win.focus()
    else win.show()
    // 第一次建的窗口页面还没加载，由页面挂载时自己聚焦输入框；复用的窗口让它聚焦
    if (existed) win.send('memo-window:focus-input')
  }

  /** 关掉 = 隐藏（焦点由系统交回之前的程序），并记下位置 */
  close(): void {
    if (!this.win || !this.win.isVisible()) return
    this.save()
    this.win.hide()
  }

  /** 发给小窗（没建过时什么也不做） */
  send<K extends EventChannel>(channel: K, ...args: EventArgs<K>): void {
    this.win?.send(channel, ...args)
  }

  /** 等排队中的位置写盘完成（测试与退出前用） */
  flush(): Promise<void> {
    return this.queue.run(async () => {})
  }

  private ensureWindow(): MemoWindowHandle {
    if (this.win) return this.win
    const bounds = placeMemoWindow({
      saved: this.saved,
      workAreas: this.port.workAreas(),
      mainArea: this.port.mainArea(),
    })
    this.win = this.port.create(bounds, {
      onBoundsChanged: () => this.save(),
      onCloseRequest: () => this.close(),
    })
    return this.win
  }

  /** 写盘失败只记警告：丢的只是窗口位置 */
  private save(): void {
    if (!this.win) return
    const bounds = this.win.getBounds()
    this.saved = bounds
    const data: MemoWindowFile = { version: MEMO_WINDOW_FILE_VERSION, bounds }
    void this.queue.run(() =>
      writeJsonAtomic(this.file, data).catch((err: unknown) => {
        console.warn(`[memo] 备忘小窗的位置没能写盘：${(err as Error).message}`)
      }),
    )
  }
}
