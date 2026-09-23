/**
 * 全局快捷键按下时唤出还是藏起窗口（纯函数，不 import electron）：一个键开关，像下拉终端。
 * 窗口在前台（可见、没最小化、聚焦）→ 藏到托盘；隐藏、最小化或被别的窗口挡在后面 → 还原、显示并聚焦。
 */
export interface WindowState {
  isVisible: boolean
  isMinimized: boolean
  isFocused: boolean
}

export function decideSummon(state: WindowState): 'show' | 'hide' {
  return state.isVisible && !state.isMinimized && state.isFocused ? 'hide' : 'show'
}
