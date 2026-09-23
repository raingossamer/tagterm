/**
 * 假的系统热键表（ShortcutPort 的测试替身）：occupied 里的键位被「别的程序」占着，注册失败；press 模拟按下。
 */
import type { ShortcutPort } from '../../src/main/shortcut/GlobalShortcut'

export class FakeShortcutPort implements ShortcutPort {
  readonly registered = new Map<string, () => void>()
  readonly occupied = new Set<string>()
  register(accelerator: string, onPress: () => void): boolean {
    if (this.occupied.has(accelerator) || this.registered.has(accelerator)) return false
    this.registered.set(accelerator, onPress)
    return true
  }
  unregister(accelerator: string): void {
    this.registered.delete(accelerator)
  }
  press(accelerator: string): void {
    this.registered.get(accelerator)?.()
  }
}
