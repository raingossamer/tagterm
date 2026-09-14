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
  type LaunchCommand,
  type Settings,
  type SettingsFile,
} from '@shared/models'
import { readJson, writeJsonAtomic } from './jsonFile'
import { readImageAsDataUrl, type ShrinkImage } from './backgroundImage'

const SETTINGS_FILE = 'settings.json'

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
      this.settings = {
        launchCommands: this.seedCommands.map((command, i) => seedCommand(command, i + 1)),
        background: { ...DEFAULT_BACKGROUND },
      }
      await this.save()
      console.log(`[store] 已生成默认设置：${this.file}`)
      return
    }
    const file = raw as Partial<SettingsFile> & { terminalBackground?: unknown }
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
      this.settings = { launchCommands, background: migrateBackground(file) }
      await this.save()
      console.log(
        `[store] 设置文件已从 v${file.version} 迁移到 v${SETTINGS_FILE_VERSION}：${this.file}`,
      )
      return
    }
    this.settings = {
      launchCommands,
      background: { ...DEFAULT_BACKGROUND, ...(file.background ?? {}) },
    }
    console.log(
      `[store] 已加载设置（${this.settings.launchCommands.length} 条唤起命令）：${this.file}`,
    )
  }

  get(): Settings {
    return {
      launchCommands: [...this.settings.launchCommands],
      background: { ...this.settings.background },
    }
  }

  /** 补丁合并：给出的字段整体替换；新命令（无 id）分配 uuid */
  async update(patch: SettingsPatch): Promise<Settings> {
    if (patch.launchCommands) {
      this.settings.launchCommands = patch.launchCommands.map(withId)
    }
    if (patch.background) {
      this.settings.background = { ...patch.background }
    }
    await this.save()
    const settings = this.get()
    this.onChanged(settings)
    return settings
  }

  /** 背景图的 data: URL；未设置或文件不存在为 null（回退纯色）。传 file 可读未保存的图（设置弹窗预览） */
  readBackgroundImage(file?: string): Promise<string | null> {
    const path = file ?? this.settings.background.imagePath
    return path ? readImageAsDataUrl(path, this.shrinkImage) : Promise.resolve(null)
  }

  private async save(): Promise<void> {
    const data: SettingsFile = { version: SETTINGS_FILE_VERSION, ...this.settings }
    await writeJsonAtomic(this.file, data)
  }
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
