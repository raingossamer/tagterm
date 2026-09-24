/**
 * 「靠系统资源生效的设置」的编排（全局快捷键）：先向系统注册新键位（被占用 reject，旧的保留、不落盘）
 * → 成功才写 settings.json → 落盘失败把注册换回旧配置再抛（设置的内存也没动：SettingsStore 写盘成功才改内存），
 * 保证文件里的键位一定注册过。接口层 app:set-global-shortcut 与配置导入共用；不 import electron。
 */
import type { GlobalShortcutConfig } from '@shared/models'
import type { GlobalShortcutStatus } from '@shared/ipc'
import type { GlobalShortcut } from './GlobalShortcut'
import type { SettingsStore } from '../store/SettingsStore'

export interface ApplyGlobalShortcutDeps {
  shortcut: Pick<GlobalShortcut, 'apply' | 'revert' | 'status'>
  settings: Pick<SettingsStore, 'getGlobalShortcut' | 'setGlobalShortcut'>
}

export async function applyGlobalShortcut(
  deps: ApplyGlobalShortcutDeps,
  next: GlobalShortcutConfig,
): Promise<GlobalShortcutStatus> {
  const previous = deps.settings.getGlobalShortcut()
  if (!deps.shortcut.apply(next)) throw new Error('该快捷键已被其他程序占用')
  try {
    await deps.settings.setGlobalShortcut(next)
  } catch (err) {
    deps.shortcut.revert(previous)
    throw err
  }
  return deps.shortcut.status()
}
