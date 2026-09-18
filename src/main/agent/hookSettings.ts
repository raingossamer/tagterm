/**
 * 纯函数：Claude Code（~/.claude/settings.json）与 Codex（~/.codex/hooks.json）hooks 配置的合并 / 剥离 / 识别 / 换端口。
 * 两个文件形态相同：顶层 `hooks` 下按事件名挂条目数组，条目 `{ matcher?, hooks: [{ type: 'command', command, timeout, async }] }`，
 * Codex 的每条多一个 `commandWindows`。装哪些事件来自 hookContract 的契约表；我们的条目靠 command 里的 `/tagterm/hook/` 识别；
 * 别人的条目与其他键一律不动。
 * 命令串对 sh / cmd / PowerShell 都安全：`-T -` 读 stdin，不含 @ % $ 引号（PowerShell 把 `--data-binary @-` 报成语法错误）。
 */
import type { HookAgent } from '@shared/ipc'
import { HOOK_CONTRACTS, HOOK_PATH_PREFIX, type HookEventSpec } from './hookContract'

/** curl 自身的超时（秒）：与事件预算一致，1 s 预算的事件 curl 也只等 1 s */
function curlTimeoutSec(event: string): number {
  return event === 'Interrupt' || event === 'SessionEnd' ? 1 : 3
}

/**
 * `--noproxy 127.0.0.1` 不能省：curl 读 `http_proxy` / `ALL_PROXY` 环境变量，**回环地址也不例外**
 * （本机 curl 8.12.1 实测：设了 `http_proxy` 时请求被交给代理、我们的端点一个字也收不到，hooks 静默失效）。
 * 用 `127.0.0.1` 而不是 `*`：`*` 要引号，不引号在 sh 里会被展开成当前目录的文件名
 */
export function buildHookCommand(agent: HookAgent, port: number, event: string): string {
  return `curl.exe -s -m ${curlTimeoutSec(event)} --noproxy 127.0.0.1 -X POST -T - http://127.0.0.1:${port}${HOOK_PATH_PREFIX}${agent}`
}

export function isOurHook(command: unknown): boolean {
  return typeof command === 'string' && command.includes(HOOK_PATH_PREFIX)
}

type Json = Record<string, unknown>
interface HookEntry {
  matcher?: string
  hooks: Json[]
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 顶层 hooks 表：不是对象就当空表 */
function hooksTableOf(settings: unknown): Record<string, unknown> {
  if (!isObject(settings) || !isObject(settings['hooks'])) return {}
  return { ...settings['hooks'] }
}

function entriesOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 某事件的条目数组里是否已有我们的命令 */
/** 这个条目是我们装的吗（条目里任一命令带 `/tagterm/hook/`）：合并时按当前命令串重建它、剥离时删掉它 */
function isOurEntry(entry: unknown): boolean {
  return (
    isObject(entry) && entriesOf(entry['hooks']).some((h) => isObject(h) && isOurHook(h['command']))
  )
}

function buildEntry(agent: HookAgent, port: number, spec: HookEventSpec): HookEntry {
  const command = buildHookCommand(agent, port, spec.event)
  const hook: Json = { type: 'command', command, timeout: spec.timeoutSec, async: true }
  if (agent === 'codex') hook['commandWindows'] = command
  return spec.matcher ? { matcher: spec.matcher, hooks: [hook] } : { hooks: [hook] }
}

/** 该目标的事件各追加一条我们的条目（已有则跳过）；返回新对象，入参不动 */
export function mergeHooks(agent: HookAgent, settings: unknown, port: number): unknown {
  const base: Json = isObject(settings) ? { ...settings } : {}
  const hooks = hooksTableOf(settings)
  for (const spec of HOOK_CONTRACTS[agent].events) {
    const entries = entriesOf(hooks[spec.event])
    // 我们的条目按当前命令串重建（别人的条目原样保留、顺序不动）：内容没变即幂等，
    // 而旧版本装下的命令（比如缺 --noproxy 的那版）重新打开开关就能升级
    hooks[spec.event] = [...entries.filter((e) => !isOurEntry(e)), buildEntry(agent, port, spec)]
  }
  base['hooks'] = hooks
  return base
}

/** 只删我们的命令；条目、事件数组、hooks 表空了就一并删；返回新对象 */
export function stripHooks(settings: unknown): unknown {
  if (!isObject(settings)) return settings
  const base: Json = { ...settings }
  if (!isObject(settings['hooks'])) return base
  const hooks: Record<string, unknown> = {}
  for (const [event, value] of Object.entries(settings['hooks'])) {
    if (!Array.isArray(value)) {
      hooks[event] = value
      continue
    }
    const kept = value
      .map((entry) => {
        if (!isObject(entry) || !Array.isArray(entry['hooks'])) return entry
        const inner = entry['hooks'].filter((h) => !(isObject(h) && isOurHook(h['command'])))
        if (inner.length === entry['hooks'].length) return entry
        return inner.length === 0 ? null : { ...entry, hooks: inner }
      })
      .filter((entry) => entry !== null)
    if (kept.length > 0) hooks[event] = kept
  }
  if (Object.keys(hooks).length > 0) base['hooks'] = hooks
  else delete base['hooks']
  return base
}

/** 遍历我们的每条命令 */
function ourCommands(settings: unknown): string[] {
  const out: string[] = []
  for (const value of Object.values(hooksTableOf(settings))) {
    for (const entry of entriesOf(value)) {
      if (!isObject(entry)) continue
      for (const h of entriesOf(entry['hooks'])) {
        if (isObject(h) && isOurHook(h['command'])) out.push(h['command'] as string)
      }
    }
  }
  return out
}

const PORT_IN_COMMAND = /127\.0\.0\.1:(\d+)\//

/** 是否装了我们的 hooks，以及命令里写的端口（取第一条） */
export function hasOurHooks(settings: unknown): { installed: boolean; port: number | null } {
  const commands = ourCommands(settings)
  if (commands.length === 0) return { installed: false, port: null }
  const m = PORT_IN_COMMAND.exec(commands[0]!)
  return { installed: true, port: m ? Number(m[1]) : null }
}

/** 只把我们命令里的端口改成 port（启动时端口顺延了才用得上）；返回新对象 */
export function rewritePort(settings: unknown, port: number): unknown {
  if (!isObject(settings) || !isObject(settings['hooks'])) return settings
  const hooks: Record<string, unknown> = {}
  for (const [event, value] of Object.entries(settings['hooks'])) {
    hooks[event] = !Array.isArray(value)
      ? value
      : value.map((entry) => {
          if (!isObject(entry) || !Array.isArray(entry['hooks'])) return entry
          return {
            ...entry,
            hooks: entry['hooks'].map((h) =>
              isObject(h) && isOurHook(h['command'])
                ? rewriteCommandPort(
                    h,
                    (h['command'] as string).replace(PORT_IN_COMMAND, `127.0.0.1:${port}/`),
                  )
                : h,
            ),
          }
        })
  }
  return { ...settings, hooks }
}

function rewriteCommandPort(hook: Json, command: string): Json {
  const next: Json = { ...hook, command }
  if (typeof hook['commandWindows'] === 'string') next['commandWindows'] = command
  return next
}
