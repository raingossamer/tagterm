/**
 * 「安静」的 AgentSubsystem：真实状态机与探针逻辑照跑，只是不 start（不起 HookServer、不碰 hooks 目标文件），
 * 通知与角标静音、探针定时器永不触发、进程树由测试给定。会话编排的边界测试与接口层测试共用。
 */
import { join } from 'node:path'
import type { Session, SessionRuntime } from '@shared/models'
import { AgentSubsystem } from '../../src/main/agent/AgentSubsystem'
import type { ProcessNode } from '../../src/main/agent/processMatch'

export interface QuietAgentOptions {
  /** 放 hooks 目标文件的临时目录（不 start 时不会被读写） */
  dir: string
  sessions: () => readonly Session[]
  broadcast: (runtime: SessionRuntime) => void
  /** 某 pid 的全部后代进程；缺省没有子进程（shell 空闲） */
  listSubtree?: (pid: number) => Promise<ProcessNode[]>
}

export function createQuietAgent(opts: QuietAgentOptions): AgentSubsystem {
  return new AgentSubsystem({
    dataDir: opts.dir,
    sessions: opts.sessions,
    broadcast: opts.broadcast,
    notifications: { isSupported: () => false, show: () => {} },
    badge: { setCounts: () => {} },
    hookTargets: {
      claude: {
        agent: 'claude',
        settingsPath: join(opts.dir, 'claude-settings.json'),
        createIfMissing: false,
      },
      codex: {
        agent: 'codex',
        settingsPath: join(opts.dir, 'codex-hooks.json'),
        createIfMissing: true,
      },
    },
    listSubtree: opts.listSubtree ?? (async () => []),
    timers: { setTimer: () => 0, clearTimer: () => {} },
    preferredPort: 0,
  })
}
