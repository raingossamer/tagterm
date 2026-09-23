/**
 * 服务层：往用户的 hooks 配置文件里装 / 卸 TagTerm 的条目。一个安装器一个目标：
 *   Claude → ~/.claude/settings.json（必须已存在；这是用户的总配置，不替他新建）
 *   Codex  → ~/.codex/hooks.json（不存在则新建 `{ "hooks": {} }`；这是 hooks 专用文件，新建安全；不碰 config.toml）
 * 规则：写前先备份为 <文件>.tagterm-bak-<时间戳>（新建的不备份，内容没变的不写不备份）；只追加 / 只删我们的条目（hookSettings 纯函数）；
 * 原子写回；坏 JSON / 顶层不是对象一律拒绝且不动文件。fs 只在这里用，不 import electron。
 */
import { access, copyFile } from 'node:fs/promises'
import type { HookAgent, HooksStatus } from '@shared/ipc'
import { readJson, writeJsonAtomic } from '../store/jsonFile'
import { hasOurHooks, rebuildHooks, stripHooks } from './hookSettings'

export interface HookTarget {
  agent: HookAgent
  settingsPath: string
  /** 文件不存在时是否新建骨架（Codex 是、Claude 否） */
  createIfMissing: boolean
}

export interface HookInstallerDeps {
  now: () => number
}

const TARGET_LABEL: Record<HookAgent, string> = { claude: 'Claude Code', codex: 'Codex' }

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/**
 * 两份 JSON 内容是否相同：对象键的先后不计、数组顺序计。别的程序（Claude Code 自己保存设置）按自己的键顺序写回同样的内容时，
 * 不该触发一次改写与备份 —— 否则每次启动都多一份备份
 */
function isSameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => isSameJson(item, b[i]))
    )
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isSameJson(a[k], b[k]))
    )
  }
  return a === b
}

/** 备份文件名里的时间戳：YYYYMMDD-HHmmss（本地时间） */
function timestamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export class HookInstaller {
  constructor(
    private readonly target: HookTarget,
    private readonly deps: HookInstallerDeps,
  ) {}

  /** 当前状态：已安装则报文件里写的端口，否则报传入的当前端口；文件有问题带 error */
  async status(port: number): Promise<HooksStatus> {
    const base = { installed: false, port, settingsPath: this.target.settingsPath }
    let settings: Json | null
    try {
      settings = await this.read()
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) }
    }
    if (settings === null) {
      // Claude 的总配置缺失是个要告诉用户的问题；Codex 的专用文件缺失是常态（打开开关时新建）
      return this.target.createIfMissing ? base : { ...base, error: this.missingMessage() }
    }
    const found = hasOurHooks(settings)
    return found.installed ? { ...base, installed: true, port: found.port ?? port } : base
  }

  /** 备份 → 按当前契约重建我们的条目（顺带清掉旧版本留下的废弃事件）→ 原子写回；已装且内容没变则什么都不做 */
  async install(port: number): Promise<HooksStatus> {
    const existing = await this.read()
    if (existing === null && !this.target.createIfMissing) throw new Error(this.missingMessage())
    const current: Json = existing ?? { hooks: {} }
    await this.writeIfChanged(
      current,
      rebuildHooks(this.target.agent, current, port),
      existing !== null,
    )
    return this.status(port)
  }

  /** 备份 → 只删我们的条目 → 原子写回；未安装则不写。Codex 的文件删到空也保留 `{ "hooks": {} }` 骨架。port 只用于返回状态 */
  async uninstall(port: number): Promise<HooksStatus> {
    const existing = await this.read()
    if (existing === null) return this.status(port)
    let stripped = stripHooks(existing) as Json
    if (this.target.agent === 'codex' && !isObject(stripped['hooks']))
      stripped = { ...stripped, hooks: {} }
    await this.writeIfChanged(existing, stripped, true)
    return this.status(port)
  }

  private missingMessage(): string {
    return `未找到 ${TARGET_LABEL[this.target.agent]} 配置文件：${this.target.settingsPath}`
  }

  /**
   * 启动补装：已安装 → 按当前版本整体重建我们的条目并换成本次端口（补新事件、升级旧命令、清废弃事件）；
   * 内容没变不写不备份；未安装 / 文件缺失一律不写（绝不替用户装）；坏 JSON / 顶层不是对象抛中文 message、不动文件。
   * 返回是否真的改写了文件（装配层据此记一行日志）
   */
  async refresh(port: number): Promise<boolean> {
    const existing = await this.read()
    if (existing === null || !hasOurHooks(existing).installed) return false
    return this.writeIfChanged(existing, rebuildHooks(this.target.agent, existing, port), true)
  }

  /** 读并校验：不存在 → null；坏 JSON / 顶层不是对象 → 抛中文 message */
  private async read(): Promise<Json | null> {
    let parsed: unknown
    try {
      parsed = await readJson(this.target.settingsPath)
    } catch (err) {
      throw new Error(
        `${TARGET_LABEL[this.target.agent]} 配置文件不是合法 JSON：${this.target.settingsPath}（${err instanceof Error ? err.message : String(err)}）`,
      )
    }
    if (parsed === null) return null
    if (!isObject(parsed)) {
      throw new Error(
        `${TARGET_LABEL[this.target.agent]} 配置文件顶层不是对象：${this.target.settingsPath}`,
      )
    }
    return parsed
  }

  /** 内容变了才备份并写回；返回是否写了。「变了」按内容比，不看对象键的先后（见 isSameJson） */
  private async writeIfChanged(
    before: unknown,
    after: unknown,
    shouldBackup: boolean,
  ): Promise<boolean> {
    if (isSameJson(before, after)) return false
    if (shouldBackup) await copyFile(this.target.settingsPath, await this.backupPath())
    await writeJsonAtomic(this.target.settingsPath, after)
    return true
  }

  /** <文件>.tagterm-bak-<时间戳>；同一秒内再备份（先装后卸）不能覆盖上一份，撞名就加序号 */
  private async backupPath(): Promise<string> {
    const base = `${this.target.settingsPath}.tagterm-bak-${timestamp(this.deps.now())}`
    let candidate = base
    for (let n = 2; await exists(candidate); n += 1) candidate = `${base}-${n}`
    return candidate
  }
}
