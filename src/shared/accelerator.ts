/**
 * 全局快捷键（唤出 / 隐藏窗口）的键位串：用 Electron accelerator 的写法（`Ctrl+Alt+T`），界面显示也用它。
 * 主进程的通道守卫与渲染进程的录制共用这一份合法性规则。
 */
export const DEFAULT_GLOBAL_SHORTCUT = 'Ctrl+Alt+T'

/**
 * 合法 = 必须含 Ctrl 或 Alt（只带 Shift 的组合会吃掉普通打字），可加 Shift；修饰键按 Ctrl、Alt、Shift 的顺序各出现一次；
 * 键为大写字母、数字或 F1–F12。不收 Win 键组合（大多被 Windows 占着）
 */
const ACCELERATOR_PATTERN = /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F[1-9]|F1[0-2])$/

export function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ACCELERATOR_PATTERN.exec(value)
  return match !== null && (match[1] !== undefined || match[2] !== undefined)
}
