/**
 * 生产装配：AgentSubsystem 的唯一生产入口 —— 原生进程树适配（windowsProcessTree）与用户主目录（homedir）只在这里出现，
 * 核心文件不碰原生模块与真实的 ~/.claude / ~/.codex；hooks 目标文件由契约表给出。测试直接 new AgentSubsystem 注入假件。
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
>

/** 契约表里的目标文件 → 安装器的目标（路径相对用户主目录） */
function hookTargetOf(agent: HookAgent, home: string): HookTarget {
  const { target } = HOOK_CONTRACTS[agent]
  return {
    agent,
    settingsPath: join(home, ...target.relativePath),
    createIfMissing: target.createIfMissing,
  }
}

export function createProductionAgent(opts: ProductionAgentOptions): AgentSubsystem {
  const home = homedir()
  return new AgentSubsystem({
    ...opts,
    hookTargets: { claude: hookTargetOf('claude', home), codex: hookTargetOf('codex', home) },
    listSubtree,
  })
}
