/**
 * 纯数据 + 纯函数：Claude Code 与 Codex 的 hooks 契约，一处定义、三方消费 ——
 *   装哪些事件（hookSettings.mergeHooks / HookInstaller）、端点认哪些来源（HookServer 路由）、收到事件后状态怎么转（AgentDetector）。
 * 加一个 hooks 目标 = 加一条契约（事件表 + 目标文件 + interpret），状态机与安装器不改。
 * interpret 只回答「该 agent 的该事件在当前记录上怎么转」；SessionStart / SessionEnd 两条共通规则、抑制窗、
 * 「没有 agent 的会话不处理」由 AgentDetector 统一处理，不进契约表。不 import electron。
 */
import type { HookAgent } from '@shared/ipc'
import type { SessionRuntime } from '@shared/models'

/** 回环端点的路径前缀：HookServer 按它路由，hookSettings 靠它识别我们的命令 */
export const HOOK_PATH_PREFIX = '/tagterm/hook/'

/** pendingHint 上限：通知里的 message 可能很长 */
const MAX_HINT_LENGTH = 200

/** Claude 的哪些通知类型算「等你确认」：安装表的 matcher 与 interpret 的判定共用这一份 */
const CLAUDE_BLOCKING_TYPES: readonly string[] = [
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
]

export interface HookEventSpec {
  event: string
  /** Claude 的 Notification 只挑需要人的类型 */
  matcher?: string
  /** Codex 给 Interrupt / SessionEnd 的预算只有 1 s */
  timeoutSec: number
}

export interface HookInterpretContext {
  /** 该会话是否正被查看：Stop 后是 idle 还是 done 由它决定 */
  isViewed: boolean
}

export interface HookContract {
  agent: HookAgent
  /** 安装到用户配置文件里的事件表 */
  events: readonly HookEventSpec[]
  /** 目标文件相对用户主目录的路径；文件缺失是否新建按「文件归谁所有」判定 */
  target: { relativePath: readonly string[]; createIfMissing: boolean }
  /** 收到该 agent 的某事件后状态怎么转；null = 不转移 */
  interpret(
    event: string,
    payload: Record<string, unknown>,
    current: SessionRuntime,
    ctx: HookInterpretContext,
  ): SessionRuntime | null
}

/** 载荷里的提示文本：非空字符串才用，截断到上限；否则用 fallback */
function hintOf(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, MAX_HINT_LENGTH)
}

/** 去掉 pendingHint 的当前记录：除 blocked 之外的转移都不带提示 */
function bareOf(current: SessionRuntime): SessionRuntime {
  const { pendingHint: _hint, ...bare } = current
  return bare
}

/** 两个 agent 共有的两个事件：UserPromptSubmit → working；Stop → 被查看 ? idle : done */
function interpretShared(
  event: string,
  current: SessionRuntime,
  ctx: HookInterpretContext,
): SessionRuntime | null {
  if (event === 'UserPromptSubmit') return { ...bareOf(current), status: 'working' }
  if (event === 'Stop') return { ...bareOf(current), status: ctx.isViewed ? 'idle' : 'done' }
  return null
}

const claude: HookContract = {
  agent: 'claude',
  events: [
    { event: 'Notification', matcher: CLAUDE_BLOCKING_TYPES.join('|'), timeoutSec: 5 },
    { event: 'UserPromptSubmit', timeoutSec: 5 },
    { event: 'Stop', timeoutSec: 5 },
    { event: 'SessionStart', timeoutSec: 5 },
    { event: 'SessionEnd', timeoutSec: 1 },
  ],
  target: { relativePath: ['.claude', 'settings.json'], createIfMissing: false },
  interpret(event, payload, current, ctx) {
    if (event === 'Notification') {
      const type = payload['notification_type']
      if (typeof type !== 'string' || !CLAUDE_BLOCKING_TYPES.includes(type)) return null
      return {
        ...bareOf(current),
        status: 'blocked',
        pendingHint: hintOf(payload['message'], type),
      }
    }
    return interpretShared(event, current, ctx)
  },
}

const codex: HookContract = {
  agent: 'codex',
  events: [
    { event: 'UserPromptSubmit', timeoutSec: 5 },
    { event: 'PermissionRequest', timeoutSec: 5 },
    { event: 'Stop', timeoutSec: 5 },
    { event: 'Interrupt', timeoutSec: 1 },
    { event: 'SessionStart', timeoutSec: 5 },
    { event: 'SessionEnd', timeoutSec: 1 },
  ],
  target: { relativePath: ['.codex', 'hooks.json'], createIfMissing: true },
  interpret(event, payload, current, ctx) {
    if (event === 'PermissionRequest') {
      const input = payload['tool_input'] as Record<string, unknown> | undefined
      const hint = hintOf(input?.['description'], hintOf(payload['tool_name'], 'PermissionRequest'))
      return { ...bareOf(current), status: 'blocked', pendingHint: hint }
    }
    if (event === 'Interrupt') return { ...bareOf(current), status: 'idle' }
    return interpretShared(event, current, ctx)
  },
}

export const HOOK_CONTRACTS: Record<HookAgent, HookContract> = { claude, codex }

/** 端点认的来源，即契约表的键 */
export const HOOK_AGENTS: readonly HookAgent[] = Object.keys(HOOK_CONTRACTS) as HookAgent[]
