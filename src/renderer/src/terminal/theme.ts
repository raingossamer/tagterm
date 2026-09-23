/**
 * 终端默认选项：字体栈、Windows Campbell 配色（与原型 --t-* 一致）、ConPTY 标注。
 * 背景设为透明：纯黑 / 背景图 / 遮罩都由 TerminalPane 容器提供，换背景不必重开终端。
 */
import type { ITerminalOptions, ITheme } from '@xterm/xterm'

export const TERMINAL_FONT_FAMILY = '"Cascadia Mono", Consolas, "Microsoft YaHei", monospace'

export const CAMPBELL_THEME: ITheme = {
  background: '#0C0C0C00', // 透明，见文件头注释
  foreground: '#CCCCCC',
  cursor: '#FFFFFF',
  selectionBackground: '#FFFFFF40',
  // 滚动条滑块三态全透明：用户要求取消右侧滚动条，滚轮滚就够了（2026-09-16 反馈）。
  // 只藏滑块、不动 scrollback —— FitAddon 的 proposeDimensions 里写死
  // `scrollback === 0 ? 0 : (overviewRuler?.width || 14)`，那 14px 空档只有关掉整个回滚缓冲才能拿回来，
  // 而关掉就再也滚不上去了，与诉求相悖。改颜色零布局变化、滚轮与 scrollOnUserInput 全不受影响
  scrollbarSliderBackground: '#00000000',
  scrollbarSliderHoverBackground: '#00000000',
  scrollbarSliderActiveBackground: '#00000000',
  black: '#0C0C0C',
  red: '#C50F1F',
  green: '#13A10E',
  yellow: '#C19C00',
  blue: '#0037DA',
  magenta: '#881798',
  cyan: '#3A96DD',
  white: '#CCCCCC',
  brightBlack: '#767676',
  brightRed: '#E74856',
  brightGreen: '#16C60C',
  brightYellow: '#F9F1A5',
  brightBlue: '#3B78FF',
  brightMagenta: '#B4009E',
  brightCyan: '#61D6D6',
  brightWhite: '#F2F2F2',
}

/**
 * 终端内查找的高亮：全部匹配暗黄底、当前项主色蓝底（插件要求 #RRGGBB）；概览标尺未开启，但插件要求给颜色
 */
export const SEARCH_DECORATIONS = {
  matchBackground: '#5C4F00',
  matchOverviewRuler: '#C19C00',
  activeMatchBackground: '#0A5FD1',
  activeMatchColorOverviewRuler: '#0A5FD1',
} as const

/** 高亮上限（超出后仍能逐处跳转，但不再全部标出，计数改显示「1000+」由界面决定） */
export const SEARCH_HIGHLIGHT_LIMIT = 1000

/** osBuild 为 Windows 构建号（如 26200），xterm 据此选择 ConPTY 的兼容策略 */
export function buildTerminalOptions(osBuild: number): ITerminalOptions {
  return {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 14,
    scrollback: 5000,
    cursorBlink: true,
    cursorStyle: 'bar', // 与原生命令提示符一致的竖线光标（xterm 默认是实心方块）
    // 失焦时也保持竖线：xterm 的 cursorInactiveStyle 缺省是 'outline'（空心方块），
    // 一点侧栏 / 切到别的窗口，光标就从竖线变成方块（用户 2026-09-14 反馈「光标不是竖线」）
    cursorInactiveStyle: 'bar',
    allowProposedApi: true, // Unicode11 addon 需要
    allowTransparency: true,
    theme: CAMPBELL_THEME,
    windowsPty: osBuild > 0 ? { backend: 'conpty', buildNumber: osBuild } : { backend: 'conpty' },
  }
}
