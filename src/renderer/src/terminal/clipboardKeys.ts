/**
 * 终端按键分类（纯函数）：剪贴板按 Windows Terminal 习惯，外加全局搜索键。
 * - 粘贴：Ctrl+V / Ctrl+Shift+V / Shift+Insert
 * - 复制：Ctrl+Shift+C；Ctrl+C 仅在有选区时复制，无选区时交给终端（发送中断）
 * - 搜索：Ctrl+K 在终端里也抢下（不写 pty），交给全局监听聚焦搜索框
 * - 右键：有选区复制，无选区粘贴；但程序开了鼠标追踪（claude / codex 等 TUI）时把右键让给程序，
 *   否则程序自己按鼠标事件粘一次、我们又粘一次 → 粘两遍（Shift+右键强制走终端，与 Windows Terminal 一致）
 */
export type TerminalKeyAction = 'copy' | 'paste' | 'search' | null
export type ClipboardAction = 'copy' | 'paste' | null

export interface KeyLike {
  type: string
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function terminalKeyAction(ev: KeyLike, hasSelection: boolean): TerminalKeyAction {
  if (ev.type !== 'keydown' || ev.altKey) return null
  const key = ev.key.toLowerCase()
  if (key === 'insert' && ev.shiftKey && !ev.ctrlKey) return 'paste'
  if (!ev.ctrlKey) return null
  if (key === 'k') return 'search'
  if (key === 'v') return 'paste'
  if (key === 'c') {
    if (ev.shiftKey) return 'copy'
    return hasSelection ? 'copy' : null
  }
  return null
}

/**
 * 右键动作：有选区复制、无选区粘贴。
 * `mouseTrackingActive` 为真（程序开了鼠标追踪）且未按 Shift 时返回 null：右键交给程序，
 * 我们既不复制也不粘贴。Shift 强制走终端。这是与 Windows Terminal 一致的正确行为。
 *
 * 注意（2026-09-14 实测）：本项目走 ConPTY，ConPTY **不会**把程序的 `\e[?1000h` / `?1002h`
 * 透传给上层终端（同一次写入里的 `?2004h` 括号粘贴倒是透传了），所以 xterm 的
 * `mouseTrackingMode` 始终是 `'none'`，这条分支在当前环境下**不会触发**。
 * 它不是 claude / codex 里「右键粘贴两遍」的解药：实测我们只发出一次粘贴，重复发生在程序一侧。
 */
export function clipboardActionForRightClick(
  hasSelection: boolean,
  mouseTrackingActive = false,
  shiftKey = false,
): ClipboardAction {
  if (mouseTrackingActive && !shiftKey) return null
  return hasSelection ? 'copy' : 'paste'
}
