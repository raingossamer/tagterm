import { describe, expect, it } from 'vitest'
import { HOOK_CONTRACTS } from '../../src/main/agent/hookContract'
import {
  buildHookCommand,
  hasOurHooks,
  isOurHook,
  mergeHooks,
  rebuildHooks,
  stripHooks,
} from '../../src/main/agent/hookSettings'

const PORT = 51233
/** 装哪些事件以契约表为准：这里只断言 mergeHooks 把契约表原样落到文件里 */
const CLAUDE_HOOK_EVENTS = HOOK_CONTRACTS.claude.events
const CODEX_HOOK_EVENTS = HOOK_CONTRACTS.codex.events

describe('hookSettings（hooks 配置的纯函数）', () => {
  it('buildHookCommand：curl.exe -T - 到本地端点，带 --noproxy（curl 连回环也走代理环境变量）、不含 @ % $ 引号与 *；Interrupt / SessionEnd 超时 1 s，其余 3 s', () => {
    const cmd = buildHookCommand('claude', PORT, 'Stop')
    expect(cmd).toBe(
      'curl.exe -s -m 3 --noproxy 127.0.0.1 -X POST -T - http://127.0.0.1:51233/tagterm/hook/claude',
    )
    expect(buildHookCommand('codex', PORT, 'Interrupt')).toBe(
      'curl.exe -s -m 1 --noproxy 127.0.0.1 -X POST -T - http://127.0.0.1:51233/tagterm/hook/codex',
    )
    // `*` 不能出现：不加引号时 sh 会把它展开成当前目录的文件名
    expect(cmd).not.toContain('*')
    expect(buildHookCommand('codex', PORT, 'SessionEnd')).toContain('-m 1 ')
    expect(buildHookCommand('claude', PORT, 'SessionEnd')).toContain('-m 1 ')
    for (const c of [cmd, buildHookCommand('codex', PORT, 'PermissionRequest')]) {
      expect(c).not.toMatch(/[@%$'"]/)
    }
    expect(isOurHook(cmd)).toBe(true)
    expect(isOurHook('curl http://127.0.0.1:9/other')).toBe(false)
    expect(isOurHook(undefined)).toBe(false)
  })

  it('mergeHooks（Claude）：契约表里的每个事件各追加一条，Notification 带契约表的 matcher；条目 type command / timeout / async true；别人的条目与其他键原样；已有我们的条目按当前命令串重建（内容没变即幂等，旧版本装下的命令重新打开开关即升级）', () => {
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
    // 旧版本装下的命令串（这里模拟缺 --noproxy 的那版）：重新合并即按当前命令串重建，位置与别人的条目都不动
    const stale = JSON.parse(
      JSON.stringify(merged).replaceAll(' --noproxy 127.0.0.1', ''),
    ) as typeof merged
    expect(JSON.stringify(stale)).not.toContain('--noproxy')
    expect(mergeHooks('claude', stale, PORT)).toEqual(merged)
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

  it('rebuildHooks：旧版本装的条目按当前契约整体重建 —— 补缺失事件、升级旧命令、换成本次端口、清掉废弃事件里我们的条目；别人的条目原样、已有事件原位不动；重建两次结果不变', () => {
    // 缺 --noproxy 的旧命令、旧端口；契约里早已没有的 PreCompact 事件；没有 StopFailure
    const old = 'curl.exe -s -m 3 -X POST -T - http://127.0.0.1:40000/tagterm/hook/claude'
    const settings = {
      model: 'opus',
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'echo mine' }] },
          { hooks: [{ type: 'command', command: old, timeout: 5, async: true }] },
        ],
        PreCompact: [
          { hooks: [{ type: 'command', command: old }] },
          { hooks: [{ type: 'command', command: 'echo keep' }] },
        ],
        Notification: [
          { matcher: 'permission_prompt', hooks: [{ type: 'command', command: old }] },
        ],
      },
    }
    const rebuilt = rebuildHooks('claude', settings, PORT) as {
      model: string
      hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>
    }

    // 语义上 = 只留别人的条目，再按当前契约装一遍
    expect(rebuilt).toEqual(mergeHooks('claude', stripHooks(settings), PORT))
    expect(rebuilt.model).toBe('opus')
    expect(rebuilt.hooks['PreCompact']).toEqual([
      { hooks: [{ type: 'command', command: 'echo keep' }] },
    ])
    expect(rebuilt.hooks['Stop']![0]).toEqual(settings.hooks.Stop[0])
    for (const spec of CLAUDE_HOOK_EVENTS) {
      expect(rebuilt.hooks[spec.event], spec.event).toBeDefined()
    }
    expect(JSON.stringify(rebuilt)).not.toContain('40000')
    expect(hasOurHooks(rebuilt)).toEqual({ installed: true, port: PORT })
    // 已有事件在文件里的位置不变（Claude Code 自己改写文件时的顺序要尊重，否则每次启动都会被判成「变了」）
    expect(Object.keys(rebuilt.hooks).slice(0, 3)).toEqual(['Stop', 'PreCompact', 'Notification'])
    // 幂等：已是当前版本 → 等价且键顺序不变
    const again = rebuildHooks('claude', rebuilt, PORT)
    expect(again).toEqual(rebuilt)
    expect(JSON.stringify(again)).toBe(JSON.stringify(rebuilt))
  })

  it('rebuildHooks：Codex 的条目同样带 commandWindows；废弃事件里只剩我们的条目时整个事件键删掉', () => {
    const old = 'curl.exe -s -m 3 -X POST -T - http://127.0.0.1:40000/tagterm/hook/codex'
    const rebuilt = rebuildHooks(
      'codex',
      { hooks: { Legacy: [{ hooks: [{ type: 'command', command: old, commandWindows: old }] }] } },
      PORT,
    ) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> }
    expect(rebuilt.hooks['Legacy']).toBeUndefined()
    expect(Object.keys(rebuilt.hooks).sort()).toEqual(CODEX_HOOK_EVENTS.map((e) => e.event).sort())
    for (const entries of Object.values(rebuilt.hooks)) {
      const hook = entries[0]!.hooks[0]!
      expect(hook['commandWindows']).toBe(hook['command'])
      expect(hook['command']).toContain(`127.0.0.1:${PORT}/`)
    }
  })
})
