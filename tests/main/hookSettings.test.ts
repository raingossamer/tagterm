import { describe, expect, it } from 'vitest'
import { HOOK_CONTRACTS } from '../../src/main/agent/hookContract'
import {
  buildHookCommand,
  hasOurHooks,
  isOurHook,
  mergeHooks,
  rewritePort,
  stripHooks,
} from '../../src/main/agent/hookSettings'

const PORT = 51233
/** 装哪些事件以契约表为准：这里只断言 mergeHooks 把契约表原样落到文件里 */
const CLAUDE_HOOK_EVENTS = HOOK_CONTRACTS.claude.events
const CODEX_HOOK_EVENTS = HOOK_CONTRACTS.codex.events

describe('hookSettings（hooks 配置的纯函数）', () => {
  it('buildHookCommand：curl.exe -T - 到本地端点，不含 @ % $ 引号；Interrupt / SessionEnd 超时 1 s，其余 3 s', () => {
    const cmd = buildHookCommand('claude', PORT, 'Stop')
    expect(cmd).toBe('curl.exe -s -m 3 -X POST -T - http://127.0.0.1:51233/tagterm/hook/claude')
    expect(buildHookCommand('codex', PORT, 'Interrupt')).toBe(
      'curl.exe -s -m 1 -X POST -T - http://127.0.0.1:51233/tagterm/hook/codex',
    )
    expect(buildHookCommand('codex', PORT, 'SessionEnd')).toContain('-m 1 ')
    expect(buildHookCommand('claude', PORT, 'SessionEnd')).toContain('-m 1 ')
    for (const c of [cmd, buildHookCommand('codex', PORT, 'PermissionRequest')]) {
      expect(c).not.toMatch(/[@%$'"]/)
    }
    expect(isOurHook(cmd)).toBe(true)
    expect(isOurHook('curl http://127.0.0.1:9/other')).toBe(false)
    expect(isOurHook(undefined)).toBe(false)
  })

  it('mergeHooks（Claude）：契约表里的每个事件各追加一条，Notification 带契约表的 matcher；条目 type command / timeout / async true；别人的条目与其他键原样；已有我们的条目跳过（幂等）', () => {
    const settings = {
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] }],
      },
    }
    const merged = mergeHooks('claude', settings, PORT) as typeof settings & {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>
    }
    expect(merged).not.toBe(settings)
    expect(settings.hooks.Stop).toHaveLength(1) // 入参不被改
    expect(merged.model).toBe('opus')
    expect(Object.keys(merged.hooks).sort()).toEqual(
      [...CLAUDE_HOOK_EVENTS.map((e) => e.event), 'PreToolUse'].sort(),
    )
    expect(merged.hooks['PreToolUse']).toEqual(settings.hooks.PreToolUse)
    expect(merged.hooks['Stop']).toHaveLength(2)
    expect(merged.hooks['Stop']![0]).toEqual(settings.hooks.Stop[0])
    expect(merged.hooks['Stop']![1]).toEqual({
      hooks: [
        {
          type: 'command',
          command: buildHookCommand('claude', PORT, 'Stop'),
          timeout: 5,
          async: true,
        },
      ],
    })
    expect(merged.hooks['Notification']![0]!.matcher).toBe(
      CLAUDE_HOOK_EVENTS.find((e) => e.event === 'Notification')!.matcher,
    )
    expect(merged.hooks['UserPromptSubmit']![0]!.matcher).toBeUndefined()
    expect(merged.hooks['SessionEnd']![0]!.hooks[0]!['timeout']).toBe(1)

    expect(mergeHooks('claude', merged, PORT)).toEqual(merged)
    // 没有 hooks 键 / 不是对象也能装
    expect((mergeHooks('claude', {}, PORT) as { hooks: object }).hooks).toBeDefined()
    expect(
      Object.keys((mergeHooks('claude', { hooks: 'x' }, PORT) as { hooks: object }).hooks),
    ).toHaveLength(CLAUDE_HOOK_EVENTS.length)
  })

  it('mergeHooks（Codex）：契约表里的每个事件各一条、不设 matcher、每条带 commandWindows（与 command 同串）、超时取契约表', () => {
    const merged = mergeHooks('codex', { hooks: {} }, PORT) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>
    }
    expect(Object.keys(merged.hooks).sort()).toEqual(CODEX_HOOK_EVENTS.map((e) => e.event).sort())
    for (const { event } of CODEX_HOOK_EVENTS) {
      const entry = merged.hooks[event]![0]!
      expect(entry.matcher).toBeUndefined()
      const hook = entry.hooks[0]!
      expect(hook['command']).toBe(buildHookCommand('codex', PORT, event))
      expect(hook['commandWindows']).toBe(hook['command'])
      expect(hook['async']).toBe(true)
      expect(hook['timeout']).toBe(CODEX_HOOK_EVENTS.find((e) => e.event === event)!.timeoutSec)
    }
  })

  it('stripHooks：只删我们的条目，空掉的事件数组与空掉的 hooks 键一并删，别人的原样；hasOurHooks 报告安装与端口', () => {
    const settings = {
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] }],
      },
    }
    const merged = mergeHooks('claude', settings, PORT)
    expect(hasOurHooks(merged)).toEqual({ installed: true, port: PORT })
    expect(hasOurHooks(settings)).toEqual({ installed: false, port: null })
    expect(hasOurHooks({})).toEqual({ installed: false, port: null })
    expect(hasOurHooks('nope')).toEqual({ installed: false, port: null })

    expect(stripHooks(merged)).toEqual(settings)
    expect(stripHooks(mergeHooks('codex', { hooks: {} }, PORT))).toEqual({})
    expect(stripHooks({ model: 'x' })).toEqual({ model: 'x' })

    // 我们的命令和别人的命令混在同一个条目里：只删我们那一个
    const mixed = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'echo mine' },
              { type: 'command', command: buildHookCommand('claude', PORT, 'Stop') },
            ],
          },
        ],
      },
    }
    expect(stripHooks(mixed)).toEqual({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    })
  })

  it('rewritePort：只改我们命令里的端口，其他一律不动；端口相同返回等价对象', () => {
    const merged = mergeHooks('claude', { hooks: { Stop: [{ hooks: [{ command: 'x' }] }] } }, PORT)
    const moved = rewritePort(merged, 60000)
    expect(hasOurHooks(moved)).toEqual({ installed: true, port: 60000 })
    expect(JSON.stringify(moved).includes(String(PORT))).toBe(false)
    expect(stripHooks(moved)).toEqual(stripHooks(merged))
    expect(rewritePort(merged, PORT)).toEqual(merged)
  })
})
