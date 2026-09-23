/**
 * 平台层：全局快捷键服务 ShortcutPort 的 Electron 适配器（globalShortcut）。
 * 烟测实例不碰系统热键（dryRun）：系统热键整机共享，烟测不得占用、也不该与用户正在跑的实例抢；
 * dryRun 时注册一律「成功」但什么都不做，唤出 / 隐藏的逻辑由烟测直接调用来核查。
 */
import { globalShortcut } from 'electron'
import type { ShortcutPort } from '../shortcut/GlobalShortcut'

export function electronShortcuts(opts: { dryRun: boolean }): ShortcutPort {
  if (opts.dryRun) return { register: () => true, unregister: () => {} }
  return {
    register(accelerator, onPress) {
      try {
        return globalShortcut.register(accelerator, onPress)
      } catch (err) {
        console.warn(`[shortcut] 注册 ${accelerator} 出错`, err)
        return false
      }
    },
    unregister(accelerator) {
      globalShortcut.unregister(accelerator)
    },
  }
}
