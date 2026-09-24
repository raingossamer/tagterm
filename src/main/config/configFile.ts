/**
 * 配置文件（导出 / 导入的 JSON）的组装与解析：纯函数，不碰文件系统、不 import electron。
 * 文件带格式标记与版本；解析时整份校验，任一项不合法即整份拒绝并写明是哪一项（中文）；
 * 文件里没有的项就是没有（导入时不动本机），未知的顶层键忽略。带的是用户偏好：标签、唤起命令、外观参数、
 * 全局快捷键、开机自启、hooks 开关、终端字号；不带会话、关联与背景图片。
 */
import type { HookAgent } from '@shared/ipc'
import {
  TAG_COLORS,
  type AppBackground,
  type GlobalShortcutConfig,
  type TagColor,
} from '@shared/models'
import { isValidAccelerator } from '@shared/accelerator'
import { describeBackgroundParamsError } from '@shared/background'
import { isValidFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE } from '@shared/fontSize'

export const CONFIG_FORMAT = 'tagterm-config'
export const CONFIG_FILE_VERSION = 1

export interface ConfigTag {
  name: string
  color: TagColor
  hidden?: true
}

export interface ConfigLaunchCommand {
  label: string
  command: string
  pinned: boolean
}

/** 外观参数：背景的四个参数，不含图片路径 */
export type ConfigAppearance = Omit<AppBackground, 'imagePath'>

export type ConfigHooks = Partial<Record<HookAgent, boolean>>

export interface ConfigFileData {
  tags?: ConfigTag[]
  launchCommands?: ConfigLaunchCommand[]
  appearance?: ConfigAppearance
  globalShortcut?: GlobalShortcutConfig
  autoLaunch?: boolean
  hooks?: ConfigHooks
  terminalFontSize?: number
}

export type ConfigItemKey = keyof ConfigFileData

/** 各项在文件里的先后（组装按此写出） */
export const CONFIG_ITEM_KEYS: readonly ConfigItemKey[] = [
  'tags',
  'launchCommands',
  'appearance',
  'globalShortcut',
  'autoLaunch',
  'hooks',
  'terminalFontSize',
]

const NOT_CONFIG = '不是 TagTerm 配置文件'

/** 组装成文件对象：格式标记、版本、导出时间、应用版本在前，各项只写给了的（写盘用 writeJsonAtomic：2 空格缩进、末尾换行） */
export function buildConfigFile(
  data: ConfigFileData,
  meta: { appVersion: string; now?: Date },
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    format: CONFIG_FORMAT,
    version: CONFIG_FILE_VERSION,
    exportedAt: (meta.now ?? new Date()).toISOString(),
    appVersion: meta.appVersion,
  }
  for (const key of CONFIG_ITEM_KEYS) if (data[key] !== undefined) out[key] = data[key]
  return out
}

/** 组装成文件文本（与 writeJsonAtomic 写出的一致） */
export function composeConfigFile(
  data: ConfigFileData,
  meta: { appVersion: string; now?: Date },
): string {
  return JSON.stringify(buildConfigFile(data, meta), null, 2) + '\n'
}

/** 解析文件文本：不是配置文件 / 版本过高 / 任一项不合法都抛中文 message */
export function parseConfigFile(text: string): ConfigFileData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(NOT_CONFIG)
  }
  if (!isPlainObject(raw) || raw.format !== CONFIG_FORMAT || !Number.isInteger(raw.version)) {
    throw new Error(NOT_CONFIG)
  }
  if ((raw.version as number) > CONFIG_FILE_VERSION) {
    throw new Error(
      `配置文件版本 ${raw.version} 高于本程序支持的版本 ${CONFIG_FILE_VERSION}，请升级 TagTerm`,
    )
  }
  const data: ConfigFileData = {}
  if (raw.tags !== undefined) data.tags = parseTags(raw.tags)
  if (raw.launchCommands !== undefined)
    data.launchCommands = parseLaunchCommands(raw.launchCommands)
  if (raw.appearance !== undefined) data.appearance = parseAppearance(raw.appearance)
  if (raw.globalShortcut !== undefined)
    data.globalShortcut = parseGlobalShortcut(raw.globalShortcut)
  if (raw.autoLaunch !== undefined) {
    if (typeof raw.autoLaunch !== 'boolean') throw new Error('配置文件里的开机自启格式不正确')
    data.autoLaunch = raw.autoLaunch
  }
  if (raw.hooks !== undefined) data.hooks = parseHooks(raw.hooks)
  if (raw.terminalFontSize !== undefined) {
    if (!isValidFontSize(raw.terminalFontSize)) {
      throw new Error(`配置文件里的终端字号必须是 ${MIN_FONT_SIZE} 到 ${MAX_FONT_SIZE} 之间的整数`)
    }
    data.terminalFontSize = raw.terminalFontSize
  }
  return data
}

function parseTags(value: unknown): ConfigTag[] {
  if (!Array.isArray(value)) throw new Error('配置文件里的标签格式不正确')
  const seen = new Set<string>()
  return value.map((item) => {
    if (!isPlainObject(item) || typeof item.name !== 'string') {
      throw new Error('配置文件里的标签格式不正确')
    }
    const name = item.name.trim()
    if (!name) throw new Error('配置文件里的标签名不能为空')
    if (seen.has(name)) throw new Error(`配置文件里的标签重名：${name}`)
    seen.add(name)
    if (!(TAG_COLORS as readonly string[]).includes(item.color as string)) {
      throw new Error(`配置文件里的标签颜色不支持：${String(item.color)}`)
    }
    if (item.hidden !== undefined && typeof item.hidden !== 'boolean') {
      throw new Error('配置文件里的标签格式不正确')
    }
    const tag: ConfigTag = { name, color: item.color as TagColor }
    if (item.hidden === true) tag.hidden = true
    return tag
  })
}

function parseLaunchCommands(value: unknown): ConfigLaunchCommand[] {
  if (!Array.isArray(value)) throw new Error('配置文件里的唤起命令格式不正确')
  return value.map((item) => {
    if (!isPlainObject(item)) throw new Error('配置文件里的唤起命令格式不正确')
    if (typeof item.command !== 'string' || !item.command.trim()) {
      throw new Error('配置文件里的唤起命令不能为空')
    }
    if (
      (item.label !== undefined && typeof item.label !== 'string') ||
      typeof item.pinned !== 'boolean'
    ) {
      throw new Error('配置文件里的唤起命令格式不正确')
    }
    const command = item.command.trim()
    return {
      label: (item.label as string | undefined)?.trim() || command,
      command,
      pinned: item.pinned,
    }
  })
}

function parseAppearance(value: unknown): ConfigAppearance {
  if (!isPlainObject(value)) throw new Error('配置文件里的外观格式不正确')
  const error = describeBackgroundParamsError(value)
  if (error) throw new Error(`配置文件里的外观：${error}`)
  return {
    fit: value.fit as ConfigAppearance['fit'],
    imageOpacity: value.imageOpacity as number,
    panelOpacity: value.panelOpacity as number,
    blurPx: value.blurPx as number,
  }
}

function parseGlobalShortcut(value: unknown): GlobalShortcutConfig {
  if (
    !isPlainObject(value) ||
    typeof value.enabled !== 'boolean' ||
    !isValidAccelerator(value.accelerator)
  ) {
    throw new Error('配置文件里的全局快捷键格式不正确')
  }
  return { enabled: value.enabled, accelerator: value.accelerator as string }
}

function parseHooks(value: unknown): ConfigHooks {
  if (!isPlainObject(value)) throw new Error('配置文件里的 hooks 开关格式不正确')
  const hooks: ConfigHooks = {}
  for (const agent of ['claude', 'codex'] as const) {
    const flag = value[agent]
    if (flag === undefined) continue
    if (typeof flag !== 'boolean') throw new Error('配置文件里的 hooks 开关格式不正确')
    hooks[agent] = flag
  }
  return hooks
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
