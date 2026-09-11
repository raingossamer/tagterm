/**
 * 终端按键分类（纯函数）：剪贴板按 Windows Terminal 习惯，外加全局搜索键。
 * - 粘贴：Ctrl+V / Ctrl+Shift+V / Shift+Insert
 * - 复制：Ctrl+Shift+C；Ctrl+C 仅在有选区时复制，无选区时交给终端（发送中断）
 * - 搜索：Ctrl+K 在终端里也抢下（不写 pty），交给全局监听聚焦搜索框
 * - 右键：有选区复制，无选区粘贴
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

export function clipboardActionForRightClick(hasSelection: boolean): ClipboardAction {
  return hasSelection ? 'copy' : 'paste'
}
