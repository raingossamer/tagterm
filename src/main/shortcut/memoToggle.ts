/**
 * 本周备忘热键按下时做什么（不 import electron）：「记完就回去」——
 * 备忘录没开 → 唤出窗口并打开；开着且窗口在前台 → 关掉，如果这次是热键从托盘 / 后台叫出来的，窗口也藏回去；
 * 开着但窗口不在前台 → 把窗口叫到前面（仍算打开）。
 * 用 Esc / 遮罩 / 按钮关掉、或经左栏按钮 / 托盘菜单打开时，渲染进程经 app:memo-visibility 报开关，「从后台叫出来」随之作废。
 */
import type { WindowState } from './summon'

export type MemoAction = 'open' | 'close' | 'close-and-hide'

export interface MemoToggleState extends WindowState {
  memoOpen: boolean
  summonedFromBackground: boolean
}

export function decideMemoToggle(state: MemoToggleState): MemoAction {
  const isFront = state.isVisible && !state.isMinimized && state.isFocused
  if (!state.memoOpen || !isFront) return 'open'
  return state.summonedFromBackground ? 'close-and-hide' : 'close'
}

/** 记住「备忘录开着没有」「这次是不是热键从后台叫出来的」；装配层只按 press 的结果去显示 / 藏窗口、发广播 */
export class MemoToggle {
  private memoOpen = false
  private summonedFromBackground = false

  press(win: WindowState): MemoAction {
    const action = decideMemoToggle({
      ...win,
      memoOpen: this.memoOpen,
      summonedFromBackground: this.summonedFromBackground,
    })
    if (action === 'open') {
      // 窗口原本就在前台时打开的，之后再按只关不藏；已经记下「从后台叫出来」的不因再叫一次而作废
      this.summonedFromBackground ||= !(win.isVisible && !win.isMinimized && win.isFocused)
      this.memoOpen = true
    } else {
      this.memoOpen = false
      this.summonedFromBackground = false
    }
    return action
  }

  /** 渲染进程报开关：关掉（不论怎么关的）即作废「从后台叫出来」 */
  visibilityChanged(open: boolean): void {
    this.memoOpen = open
    if (!open) this.summonedFromBackground = false
  }
}
