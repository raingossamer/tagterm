/**
 * 服务层（深模块）：配置导入导出的编排。导出 = 读各处偏好写成一份文件；导入 = 解析校验 → 备份当前偏好 → 逐项应用 → 汇总结果。
 * 偏好散在五处（设置 store、标签 store、全局快捷键、系统登录项、hooks 安装器），都以结构子集 / 命名端口注入；
 * 文件对话框是 Electron 能力，以命名端口 ConfigDialogPort 注入（平台层适配器在 platform/configDialogs.ts）。
 * 路径只从对话框来，渲染进程只交出终端字号（它存在渲染进程）。不 import electron
 */
import type { AutoLaunchStatus, ConfigExportResult, ConfigPrefs } from '@shared/ipc'
import type { AgentSubsystem } from '../agent/AgentSubsystem'
import type { GlobalShortcut } from '../shortcut/GlobalShortcut'
import type { SettingsStore } from '../store/SettingsStore'
import type { TagStore } from '../store/TagStore'
import { writeJsonAtomic } from '../store/jsonFile'
import { buildConfigFile, type ConfigFileData } from './configFile'

/** 文件对话框（Electron 能力的命名端口）：取消为 null */
export interface ConfigDialogPort {
  /** 保存对话框：给缺省文件名，返回用户选的路径 */
  pickSavePath(defaultName: string): Promise<string | null>
  /** 打开对话框：返回用户选的文件 */
  pickOpenPath(): Promise<string | null>
}

/** 系统登录项（开机自启）的读写：真相在系统，不进 store */
export interface AutoLaunchPort {
  get(): AutoLaunchStatus
  set(enabled: boolean): AutoLaunchStatus
}

export interface ConfigServiceDeps {
  settings: Pick<SettingsStore, 'get' | 'getGlobalShortcut' | 'update' | 'setGlobalShortcut'>
  tags: Pick<TagStore, 'list' | 'importByName'>
  shortcut: Pick<GlobalShortcut, 'apply' | 'revert' | 'status'>
  autoLaunch: AutoLaunchPort
  hooks: Pick<AgentSubsystem, 'hooksStatus' | 'setHooks'>
  dialogs: ConfigDialogPort
  appVersion: string
  /** 数据目录：导入前的备份写在它的 backups 子目录 */
  dataDir: string
  /** 当前时间（测试注入固定值） */
  now?: () => Date
}

export class ConfigService {
  constructor(private readonly deps: ConfigServiceDeps) {}

  /** 导出：保存对话框选路径（取消为 null）→ 读当前全部偏好 → 原子写；返回写到的路径 */
  async exportConfig(prefs: ConfigPrefs): Promise<ConfigExportResult | null> {
    const now = this.now()
    const path = await this.deps.dialogs.pickSavePath(defaultExportName(now))
    if (path === null) return null
    const data = await this.collect(prefs)
    await writeJsonAtomic(path, buildConfigFile(data, { appVersion: this.deps.appVersion, now }))
    console.log(`[config] 已导出配置：${path}`)
    return { path }
  }

  /** 当前全部偏好（导出与导入前的备份共用）：标签与唤起命令按 sortOrder，外观不带图片路径，hooks 取已安装与否 */
  async collect(prefs: ConfigPrefs): Promise<ConfigFileData> {
    const settings = this.deps.settings.get()
    const hooks = await this.deps.hooks.hooksStatus()
    const { imagePath: _imagePath, ...appearance } = settings.background
    return {
      tags: [...this.deps.tags.list().tags]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({
          name: t.name,
          color: t.color,
          ...(t.hidden ? { hidden: true as const } : {}),
        })),
      launchCommands: [...settings.launchCommands]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ label: c.label, command: c.command, pinned: c.pinned })),
      appearance,
      globalShortcut: this.deps.settings.getGlobalShortcut(),
      autoLaunch: this.deps.autoLaunch.get().enabled,
      hooks: { claude: hooks.claude.installed, codex: hooks.codex.installed },
      terminalFontSize: prefs.terminalFontSize,
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
}

/** 导出文件的缺省名：tagterm-config-<本地日期 yyyyMMdd>.json */
export function defaultExportName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `tagterm-config-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`
}
