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
