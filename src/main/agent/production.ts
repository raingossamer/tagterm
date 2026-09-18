/**
 * 生产装配：AgentSubsystem 的唯一生产入口 —— 原生进程树适配（windowsProcessTree）与用户主目录（homedir）只在这里出现，
 * 核心文件不碰原生模块与真实的 ~/.claude / ~/.codex；hooks 目标文件由契约表给出。测试直接 new AgentSubsystem 注入假件。
 * 烟测实例（isSmoke）的 hooks 目标改指数据目录下的假主目录：`start()` 会把已安装的 hooks 命令同步成本实例的端口，
 * 指着真实主目录就会把用户正在用的 ~/.claude / ~/.codex 改写成烟测实例的端口，烟测一退出用户的 hooks 当场变哑
 *（2026-09-18 实际发生过）。「烟测实例与用户正在运行的实例隔离」是边界规则，这里是它的第三处落地（前两处是 userData 与数据目录）。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HookAgent } from '@shared/ipc'
import { AgentSubsystem, type AgentSubsystemOptions } from './AgentSubsystem'
import { HOOK_CONTRACTS } from './hookContract'
import type { HookTarget } from './HookInstaller'
import { listSubtree } from './windowsProcessTree'

export type ProductionAgentOptions = Pick<
  AgentSubsystemOptions,
  'dataDir' | 'sessions' | 'broadcast' | 'notifications' | 'badge'
> & {
  /** 烟测实例：hooks 目标隔离到 `<dataDir>/fake-home`，绝不碰用户真实的配置文件 */
  isSmoke: boolean
}

/** 契约表里的目标文件 → 安装器的目标（路径相对给定的主目录） */
function hookTargetOf(agent: HookAgent, home: string): HookTarget {
  const { target } = HOOK_CONTRACTS[agent]
  return {
    agent,
    settingsPath: join(home, ...target.relativePath),
    createIfMissing: target.createIfMissing,
  }
}

/** hooks 目标所在的主目录：烟测隔离到数据目录下，正常运行才是真实主目录 */
export function hookHomeOf(dataDir: string, isSmoke: boolean): string {
  return isSmoke ? join(dataDir, 'fake-home') : homedir()
}

export function createProductionAgent(opts: ProductionAgentOptions): AgentSubsystem {
  const home = hookHomeOf(opts.dataDir, opts.isSmoke)
  return new AgentSubsystem({
    ...opts,
    hookTargets: { claude: hookTargetOf('claude', home), codex: hookTargetOf('codex', home) },
    listSubtree,
  })
}
