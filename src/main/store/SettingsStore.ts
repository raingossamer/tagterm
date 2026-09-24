/**
 * 服务层（深模块）：settings.json 的加载、更新、版本校验与原子写。
 * 首次运行（文件不存在）按注入的 seedCommands（装配层的 PATH 探测结果）生成唤起命令并落盘；
 * 之后完全以文件为准。目录以构造参数注入；不 import electron。
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { LaunchCommandInput, SettingsPatch } from '@shared/ipc'
import {
  DEFAULT_BACKGROUND,
  SETTINGS_FILE_VERSION,
  type AppBackground,
  type GlobalShortcutConfig,
  type LaunchCommand,
  type Settings,
  type SettingsFile,
} from '@shared/models'
import { DEFAULT_GLOBAL_SHORTCUT, isValidAccelerator } from '@shared/accelerator'
import { readJson, writeJsonAtomic } from './jsonFile'
import { assertImageReadable, readImageAsDataUrl, type ShrinkImage } from './backgroundImage'

const SETTINGS_FILE = 'settings.json'

/** 全局快捷键缺省：开启 + Ctrl+Alt+T（文件里不写这个键） */
const DEFAULT_GLOBAL_SHORTCUT_CONFIG: GlobalShortcutConfig = {
  enabled: true,
  accelerator: DEFAULT_GLOBAL_SHORTCUT,
}

export interface SettingsStoreDeps {
  /** 首次运行的唤起命令来源（已安装的工具名） */
  seedCommands: readonly string[]
  /** 每次 update 落盘后回调全量设置，由装配层广播 settings:changed */
  onChanged?: (settings: Settings) => void
  /** 背景图缩放（装配层用 Electron nativeImage 注入）；不传则原样读取 */
  shrinkImage?: ShrinkImage
}

export class SettingsStore {
  private settings: Settings = {
    launchCommands: [],
    background: DEFAULT_BACKGROUND,
  }
  private readonly file: string
  private readonly seedCommands: readonly string[]
  private readonly onChanged: (settings: Settings) => void
  private readonly shrinkImage: ShrinkImage | undefined

  constructor(dir: string, deps: SettingsStoreDeps) {
    this.file = join(dir, SETTINGS_FILE)
    this.seedCommands = deps.seedCommands
    this.onChanged = deps.onChanged ?? (() => {})
    this.shrinkImage = deps.shrinkImage
  }

  /** 文件不存在 → 生成默认设置并写出 */
  async load(): Promise<void> {
    const raw = await readJson(this.file)
    if (raw === null) {
      await this.commit({
        launchCommands: this.seedCommands.map((command, i) => seedCommand(command, i + 1)),
        background: { ...DEFAULT_BACKGROUND },
      })
      console.log(`[store] 已生成默认设置：${this.file}`)
      return
    }
    const file = raw as Partial<SettingsFile> & {
      terminalBackground?: unknown
      globalShortcut?: unknown
    }
    if (typeof file.version !== 'number' || !Array.isArray(file.launchCommands)) {
      throw new Error(`设置文件格式不正确：${this.file}`)
    }
    if (file.version > SETTINGS_FILE_VERSION) {
      throw new Error(
        `设置文件版本 ${file.version} 高于本程序支持的版本 ${SETTINGS_FILE_VERSION}，请升级 TagTerm：${this.file}`,
      )
    }
    const launchCommands = file.launchCommands as LaunchCommand[]
    // 低版本逐版本迁移后立即写回（约定见 database/sql.md），下次启动不必再迁
    if (file.version < SETTINGS_FILE_VERSION) {
      await this.commit({ launchCommands, background: migrateBackground(file) })
      console.log(
        `[store] 设置文件已从 v${file.version} 迁移到 v${SETTINGS_FILE_VERSION}：${this.file}`,
      )
      return
    }
    this.settings = {
      launchCommands,
      background: { ...DEFAULT_BACKGROUND, ...(file.background ?? {}) },
    }
    // 可选字段：不合法（手改坏了）按缺省处理、下次写入时丢掉，不因它拒绝加载整份设置
    if (file.globalShortcut !== undefined) {
      if (isGlobalShortcutConfig(file.globalShortcut))
        this.settings.globalShortcut = { ...file.globalShortcut }
      else console.warn(`[store] 设置里的全局快捷键格式不正确，按缺省处理：${this.file}`)
    }
    console.log(
      `[store] 已加载设置（${this.settings.launchCommands.length} 条唤起命令）：${this.file}`,
    )
  }

  get(): Settings {
    const { globalShortcut } = this.settings
    return {
      launchCommands: [...this.settings.launchCommands],
      background: { ...this.settings.background },
      ...(globalShortcut ? { globalShortcut: { ...globalShortcut } } : {}),
    }
  }

  /** 全局快捷键配置（文件里没有即缺省：开启 + Ctrl+Alt+T） */
  getGlobalShortcut(): GlobalShortcutConfig {
    return { ...(this.settings.globalShortcut ?? DEFAULT_GLOBAL_SHORTCUT_CONFIG) }
  }

  /** 写全局快捷键配置（接口层在注册成功后才调）：等于缺省值时删键；落盘成功才改内存并回调全量设置 */
  async setGlobalShortcut(config: GlobalShortcutConfig): Promise<void> {
    const isDefault =
      config.enabled === DEFAULT_GLOBAL_SHORTCUT_CONFIG.enabled &&
      config.accelerator === DEFAULT_GLOBAL_SHORTCUT_CONFIG.accelerator
    const next: Settings = { ...this.settings }
    if (isDefault) delete next.globalShortcut
    else next.globalShortcut = { ...config }
    await this.commit(next)
    this.onChanged(this.get())
  }

  /** 补丁合并：给出的字段整体替换；新命令（无 id）分配 uuid。落盘成功才改内存 */
  async update(patch: SettingsPatch): Promise<Settings> {
    const next: Settings = { ...this.settings }
    if (patch.launchCommands) next.launchCommands = patch.launchCommands.map(withId)
    if (patch.background) {
      const { imagePath } = patch.background
      // 换了新图：读取时会被拒绝的（太大、格式不支持）不让存 —— 存进去的坏图每次启动都读不出来。
      // 路径没变不查：存进去之后文件才变大的，不拦用户改别的
      if (imagePath !== null && imagePath !== this.settings.background.imagePath)
        await assertImageReadable(imagePath)
      next.background = { ...patch.background }
    }
    await this.commit(next)
    const settings = this.get()
    this.onChanged(settings)
    return settings
  }

  /** 背景图的 data: URL；未设置或文件不存在为 null（回退纯色）。传 file 可读未保存的图（设置弹窗预览） */
  readBackgroundImage(file?: string): Promise<string | null> {
    const path = file ?? this.settings.background.imagePath
    return path ? readImageAsDataUrl(path, this.shrinkImage) : Promise.resolve(null)
  }

  /**
   * 先写盘、成功才换内存：写失败时内存仍与文件一致，之后别的变更落盘不会把这次没写进去的改动带进文件
   * （全局快捷键落盘失败时接口层已把系统注册换回旧的，内存再停在新键位就只回滚了一半）
   */
  private async commit(next: Settings): Promise<void> {
    const data: SettingsFile = { version: SETTINGS_FILE_VERSION, ...next }
    await writeJsonAtomic(this.file, data)
    this.settings = next
  }
}

function isGlobalShortcutConfig(value: unknown): value is GlobalShortcutConfig {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  return typeof o.enabled === 'boolean' && isValidAccelerator(o.accelerator)
}

/** v1 → v2：只继承图片路径；dimOpacity 是终端上方的黑色遮罩，在全局背景模型里没有对应物，丢弃 */
function migrateBackground(file: { terminalBackground?: unknown }): AppBackground {
  const legacy = (file.terminalBackground ?? {}) as { imagePath?: unknown }
  const imagePath = typeof legacy.imagePath === 'string' ? legacy.imagePath : null
  return { ...DEFAULT_BACKGROUND, imagePath }
}

function seedCommand(command: string, sortOrder: number): LaunchCommand {
  return { id: randomUUID(), label: command, command, pinned: true, sortOrder }
}

function withId(input: LaunchCommandInput): LaunchCommand {
  return { ...input, id: input.id ?? randomUUID() }
}
