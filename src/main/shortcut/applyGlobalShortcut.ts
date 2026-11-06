/**
 * 「靠系统资源生效的设置」的编排（两个全局快捷键：唤出 / 隐藏窗口、本周备忘）：
 * 两个热键不能是同一个组合（对方关着时不算）→ 先向系统注册新键位（被占用 reject，旧的保留、不落盘）
 * → 成功才写 settings.json → 落盘失败把注册换回旧配置再抛（设置的内存也没动：SettingsStore 写盘成功才改内存），
 * 保证文件里的键位一定注册过。接口层两个 set 通道与配置导入共用；不 import electron。
 */
import type { GlobalShortcutConfig } from '@shared/models'
import type { GlobalShortcutStatus } from '@shared/ipc'
import type { GlobalShortcut } from './GlobalShortcut'
import type { SettingsStore } from '../store/SettingsStore'

type ShortcutService = Pick<GlobalShortcut, 'apply' | 'revert' | 'status'>
type ShortcutSettings = Pick<
  SettingsStore,
  'getGlobalShortcut' | 'setGlobalShortcut' | 'getMemoShortcut' | 'setMemoShortcut'
>

export interface ApplyGlobalShortcutDeps {
  shortcut: ShortcutService
  settings: ShortcutSettings
}

export interface ApplyMemoShortcutDeps {
  memoShortcut: ShortcutService
  settings: ShortcutSettings
}

/** 一个热键的读写：自己的服务与配置，以及另一个热键（查同键） */
interface ShortcutSlot {
  service: ShortcutService
  read(): GlobalShortcutConfig
  write(config: GlobalShortcutConfig): Promise<void>
  other: { read(): GlobalShortcutConfig; name: string }
}

export function applyGlobalShortcut(
  deps: ApplyGlobalShortcutDeps,
  next: GlobalShortcutConfig,
): Promise<GlobalShortcutStatus> {
  const { settings } = deps
  return applyShortcut(
    {
      service: deps.shortcut,
      read: () => settings.getGlobalShortcut(),
      write: (config) => settings.setGlobalShortcut(config),
      other: { read: () => settings.getMemoShortcut(), name: '本周备忘' },
    },
    next,
  )
}

export function applyMemoShortcut(
  deps: ApplyMemoShortcutDeps,
  next: GlobalShortcutConfig,
): Promise<GlobalShortcutStatus> {
  const { settings } = deps
  return applyShortcut(
    {
      service: deps.memoShortcut,
      read: () => settings.getMemoShortcut(),
      write: (config) => settings.setMemoShortcut(config),
      other: { read: () => settings.getGlobalShortcut(), name: '唤出 / 隐藏窗口' },
    },
    next,
  )
}

async function applyShortcut(
  slot: ShortcutSlot,
  next: GlobalShortcutConfig,
): Promise<GlobalShortcutStatus> {
  const other = slot.other.read()
  if (next.enabled && other.enabled && other.accelerator === next.accelerator)
    throw new Error(`与「${slot.other.name}」的快捷键相同`)
  const previous = slot.read()
  if (!slot.service.apply(next)) throw new Error('该快捷键已被其他程序占用')
  try {
    await slot.write(next)
  } catch (err) {
    slot.service.revert(previous)
    throw err
  }
  return slot.service.status()
}
