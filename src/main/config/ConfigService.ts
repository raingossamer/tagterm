/**
 * 服务层（深模块）：配置导入导出的编排。导出 = 读各处偏好写成一份文件；导入 = 解析校验 → 备份当前偏好 → 逐项应用 → 汇总结果。
 * 偏好散在五处（设置 store、标签 store、全局快捷键、系统登录项、hooks 安装器），都以结构子集 / 命名端口注入；
 * 文件对话框是 Electron 能力，以命名端口 ConfigDialogPort 注入（平台层适配器在 platform/configDialogs.ts）。
 * 路径只从对话框来，渲染进程只交出终端字号（它存在渲染进程）。不 import electron
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AutoLaunchStatus,
  ConfigExportResult,
  ConfigImportResult,
  ConfigItemResult,
  ConfigPrefs,
  HookAgent,
  SettingsPatch,
} from '@shared/ipc'
import { AGENT_LABELS, type GlobalShortcutConfig } from '@shared/models'
import type { AgentSubsystem } from '../agent/AgentSubsystem'
import { applyGlobalShortcut } from '../shortcut/applyGlobalShortcut'
import type { GlobalShortcut } from '../shortcut/GlobalShortcut'
import type { SettingsStore } from '../store/SettingsStore'
import type { TagStore } from '../store/TagStore'
import { writeJsonAtomic } from '../store/jsonFile'
import {
  buildConfigFile,
  parseConfigFile,
  type ConfigAppearance,
  type ConfigFileData,
  type ConfigLaunchCommand,
} from './configFile'

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

/** 导入文件上限：偏好文件本来只有几 KB，超过就不是给这里的文件 */
export const MAX_CONFIG_FILE_BYTES = 1024 * 1024
/** 导入前的备份只留最近这么多份 */
export const MAX_BACKUPS = 10
const BACKUPS_DIR = 'backups'

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

  /**
   * 导入：打开对话框选文件（取消为 null）→ 读取并整份校验（不过就什么都不动、原样抛）→ 把当前偏好备份到数据目录
   * backups 下（备份写不出来整个中止）→ 按文件里给的项逐项应用（各项互不阻挡，失败写原因）→ 汇总结果。
   * 文件里没有的项不动本机；与本机相同的项不写。会话、关联与终端一概不碰
   */
  async importConfig(prefs: ConfigPrefs): Promise<ConfigImportResult | null> {
    const path = await this.deps.dialogs.pickOpenPath()
    if (path === null) return null
    const data = await this.readConfigFile(path)
    const backupPath = await this.backup(prefs)
    const items: ConfigItemResult[] = [
      await this.applyTags(data),
      ...(await this.applySettings(data)),
      await this.applyGlobalShortcut(data),
      this.applyAutoLaunch(data),
      await this.applyHooks(data),
      applyFontSize(data, prefs),
    ]
    const count = (outcome: ConfigItemResult['outcome']) =>
      items.filter((i) => i.outcome === outcome).length
    console.log(
      `[config] 已导入配置：${path}（${count('applied')} 项生效、${count('unchanged')} 项未变、${count('failed')} 项失败）；导入前备份：${backupPath}`,
    )
    return {
      path,
      backupPath,
      items,
      ...(data.terminalFontSize !== undefined ? { terminalFontSize: data.terminalFontSize } : {}),
    }
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
      launchCommands: currentLaunchCommands(settings.launchCommands),
      appearance,
      globalShortcut: this.deps.settings.getGlobalShortcut(),
      autoLaunch: this.deps.autoLaunch.get().enabled,
      hooks: { claude: hooks.claude.installed, codex: hooks.codex.installed },
      terminalFontSize: prefs.terminalFontSize,
    }
  }

  private async readConfigFile(path: string): Promise<ConfigFileData> {
    let text: string
    try {
      if ((await stat(path)).size > MAX_CONFIG_FILE_BYTES) {
        throw new Error(`配置文件过大（超过 ${MAX_CONFIG_FILE_BYTES / 1024 / 1024} MB）：${path}`)
      }
      text = await readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`配置文件不存在：${path}`, { cause: err })
      }
      throw err
    }
    return parseConfigFile(text)
  }

  /** 把当前偏好按同一格式写到 <数据目录>/backups/tagterm-config-<yyyyMMdd-HHmmss>.json（同秒撞名加序号），只留最近 10 份 */
  private async backup(prefs: ConfigPrefs): Promise<string> {
    const now = this.now()
    const dir = join(this.deps.dataDir, BACKUPS_DIR)
    const data = await this.collect(prefs)
    const path = uniquePath(dir, backupBaseName(now))
    await writeJsonAtomic(path, buildConfigFile(data, { appVersion: this.deps.appVersion, now }))
    await pruneBackups(dir)
    return path
  }

  private async applyTags(data: ConfigFileData): Promise<ConfigItemResult> {
    if (data.tags === undefined) return { key: 'tags', outcome: 'absent' }
    try {
      const { created, updated, changed } = await this.deps.tags.importByName(data.tags)
      if (!changed) return { key: 'tags', outcome: 'unchanged' }
      return {
        key: 'tags',
        outcome: 'applied',
        message: created || updated ? `新建 ${created} 个、更新 ${updated} 个` : '只调整了顺序',
      }
    } catch (err) {
      return { key: 'tags', outcome: 'failed', message: messageOf(err) }
    }
  }

  /** 唤起命令与外观参数走同一次 settings.update（背景 = 文件的四个参数 + 本机现有图片路径），各自报结果 */
  private async applySettings(data: ConfigFileData): Promise<ConfigItemResult[]> {
    const current = this.deps.settings.get()
    const patch: SettingsPatch = {}
    const results: ConfigItemResult[] = []
    if (data.launchCommands === undefined) {
      results.push({ key: 'launchCommands', outcome: 'absent' })
    } else if (isSameCommands(currentLaunchCommands(current.launchCommands), data.launchCommands)) {
      results.push({ key: 'launchCommands', outcome: 'unchanged' })
    } else {
      patch.launchCommands = data.launchCommands.map((c, i) => ({ ...c, sortOrder: i + 1 }))
      results.push({ key: 'launchCommands', outcome: 'applied' })
    }
    if (data.appearance === undefined) {
      results.push({ key: 'appearance', outcome: 'absent' })
    } else if (isSameAppearance(current.background, data.appearance)) {
      results.push({ key: 'appearance', outcome: 'unchanged' })
    } else {
      patch.background = { ...data.appearance, imagePath: current.background.imagePath }
      results.push({ key: 'appearance', outcome: 'applied' })
    }
    if (patch.launchCommands || patch.background) {
      try {
        await this.deps.settings.update(patch)
      } catch (err) {
        for (const r of results)
          if (r.outcome === 'applied')
            Object.assign(r, { outcome: 'failed', message: messageOf(err) })
      }
    }
    return results
  }

  private async applyGlobalShortcut(data: ConfigFileData): Promise<ConfigItemResult> {
    if (data.globalShortcut === undefined) return { key: 'globalShortcut', outcome: 'absent' }
    if (isSameShortcut(this.deps.settings.getGlobalShortcut(), data.globalShortcut)) {
      return { key: 'globalShortcut', outcome: 'unchanged' }
    }
    try {
      await applyGlobalShortcut(this.deps, data.globalShortcut)
      return { key: 'globalShortcut', outcome: 'applied' }
    } catch (err) {
      return { key: 'globalShortcut', outcome: 'failed', message: messageOf(err) }
    }
  }

  private applyAutoLaunch(data: ConfigFileData): ConfigItemResult {
    if (data.autoLaunch === undefined) return { key: 'autoLaunch', outcome: 'absent' }
    if (this.deps.autoLaunch.get().enabled === data.autoLaunch) {
      return { key: 'autoLaunch', outcome: 'unchanged' }
    }
    try {
      this.deps.autoLaunch.set(data.autoLaunch)
      return { key: 'autoLaunch', outcome: 'applied' }
    } catch (err) {
      return { key: 'autoLaunch', outcome: 'failed', message: messageOf(err) }
    }
  }

  /** 两个目标各自与本机状态比，不同才装 / 卸；任一失败整项记失败并写明是哪个目标 */
  private async applyHooks(data: ConfigFileData): Promise<ConfigItemResult> {
    if (data.hooks === undefined) return { key: 'hooks', outcome: 'absent' }
    const status = await this.deps.hooks.hooksStatus()
    const failures: string[] = []
    let changed = 0
    for (const agent of ['claude', 'codex'] as const satisfies readonly HookAgent[]) {
      const wanted = data.hooks[agent]
      if (wanted === undefined || status[agent].installed === wanted) continue
      try {
        await this.deps.hooks.setHooks(agent, wanted)
        changed += 1
      } catch (err) {
        failures.push(`${AGENT_LABELS[agent]}：${messageOf(err)}`)
      }
    }
    if (failures.length) return { key: 'hooks', outcome: 'failed', message: failures.join('；') }
    return { key: 'hooks', outcome: changed ? 'applied' : 'unchanged' }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
}

/** 字号存在渲染进程：这里只比对并把要套用的值放进结果，由渲染进程套用 */
function applyFontSize(data: ConfigFileData, prefs: ConfigPrefs): ConfigItemResult {
  if (data.terminalFontSize === undefined) return { key: 'terminalFontSize', outcome: 'absent' }
  if (data.terminalFontSize === prefs.terminalFontSize) {
    return { key: 'terminalFontSize', outcome: 'unchanged' }
  }
  return { key: 'terminalFontSize', outcome: 'applied' }
}

/** 导出文件的缺省名：tagterm-config-<本地日期 yyyyMMdd>.json */
export function defaultExportName(now: Date): string {
  return `tagterm-config-${localStamp(now).slice(0, 8)}.json`
}

/** 备份文件名（不含序号）：tagterm-config-<本地 yyyyMMdd-HHmmss> */
function backupBaseName(now: Date): string {
  const stamp = localStamp(now)
  return `tagterm-config-${stamp.slice(0, 8)}-${stamp.slice(8)}`
}

/** 本地时间 yyyyMMddHHmmss */
function localStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

/** <dir>/<base>.json，已存在就 <base>-2.json、-3.json… */
function uniquePath(dir: string, base: string): string {
  for (let n = 1; ; n += 1) {
    const path = join(dir, n === 1 ? `${base}.json` : `${base}-${n}.json`)
    if (!existsSync(path)) return path
  }
}

/** 只留最近 MAX_BACKUPS 份（文件名带时间戳，按名排序即按时间） */
async function pruneBackups(dir: string): Promise<void> {
  const names = (await readdir(dir))
    .filter((n) => n.startsWith('tagterm-config-') && n.endsWith('.json'))
    .sort()
  for (const name of names.slice(0, Math.max(0, names.length - MAX_BACKUPS))) {
    await unlink(join(dir, name)).catch(() => {})
  }
}

function currentLaunchCommands(
  commands: readonly { label: string; command: string; pinned: boolean; sortOrder: number }[],
): ConfigLaunchCommand[] {
  return [...commands]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ label: c.label, command: c.command, pinned: c.pinned }))
}

function isSameCommands(a: ConfigLaunchCommand[], b: ConfigLaunchCommand[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (c, i) => c.label === b[i]!.label && c.command === b[i]!.command && c.pinned === b[i]!.pinned,
    )
  )
}

function isSameAppearance(current: ConfigAppearance, next: ConfigAppearance): boolean {
  return (
    current.fit === next.fit &&
    current.imageOpacity === next.imageOpacity &&
    current.panelOpacity === next.panelOpacity &&
    current.blurPx === next.blurPx
  )
}

function isSameShortcut(a: GlobalShortcutConfig, b: GlobalShortcutConfig): boolean {
  return a.enabled === b.enabled && a.accelerator === b.accelerator
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
