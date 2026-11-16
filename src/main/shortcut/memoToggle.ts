/**
 * 本周备忘热键按下时做什么（不 import electron）：热键只管备忘小窗，不碰主窗口（memo-floating-window 决策 2）——
 * 小窗没开 → 打开；开着但焦点在别处（如正在终端里打字）→ 只把焦点交给小窗；焦点在小窗里 → 关掉（「记完就回去」，
 * 焦点由系统交回之前的程序）。小窗的状态主进程直接查窗口，不需要渲染进程回报。
 */
export type MemoAction = 'open' | 'focus' | 'close'

export interface MemoWindowState {
  isOpen: boolean
  isFocused: boolean
}

export function decideMemoToggle(state: MemoWindowState): MemoAction {
  if (!state.isOpen) return 'open'
  return state.isFocused ? 'close' : 'focus'
}
