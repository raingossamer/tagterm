import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionRuntime } from '@shared/models'
import { AgentDetector } from '../../src/main/agent/AgentDetector'

describe('AgentDetector（运行时状态机）', () => {
  let changes: SessionRuntime[]
  let removed: string[]
  let now: number
  let detector: AgentDetector

  beforeEach(() => {
    changes = []
    removed = []
    now = 1_000_000
    detector = new AgentDetector({
      now: () => now,
      onChange: (r) => changes.push(r),
      onRemove: (id) => removed.push(id),
    })
  })

  it('pty spawn → 记录 { alive: true, agent: null, status: idle } 并回调一次；重复 spawn 不重复回调', () => {
    detector.ptySpawned('s1')
    expect(detector.list()).toEqual([{ sessionId: 's1', alive: true, agent: null, status: 'idle' }])
    expect(changes).toEqual([{ sessionId: 's1', alive: true, agent: null, status: 'idle' }])

    detector.ptySpawned('s1')
    expect(changes).toHaveLength(1)
    expect(detector.list()).toHaveLength(1)
  })

  it('pty 退出 / 会话移除 → 删除记录并回调 onRemove；未知 id 无副作用', () => {
    detector.ptySpawned('s1')
    detector.ptySpawned('s2')

    detector.ptyExited('s1')
    expect(detector.list().map((r) => r.sessionId)).toEqual(['s2'])
    expect(removed).toEqual(['s1'])

    detector.sessionRemoved('s2')
    expect(detector.list()).toEqual([])
    expect(removed).toEqual(['s1', 's2'])

    detector.ptyExited('ghost')
    detector.sessionRemoved('ghost')
    expect(removed).toEqual(['s1', 's2'])
    expect(changes).toHaveLength(2)
  })

  it('进程树快照：写入 agent（变化才回调）；agent 消失 → idle 并清 pendingHint；快照里没有的会话不动；未知会话忽略', () => {
    detector.ptySpawned('s1')
    detector.ptySpawned('s2')
    changes.length = 0

    detector.processSnapshot(
      new Map([
        ['s1', 'claude'],
        ['ghost', 'pi'],
      ]),
    )
    expect(changes).toEqual([{ sessionId: 's1', alive: true, agent: 'claude', status: 'idle' }])
    expect(detector.list().find((r) => r.sessionId === 's2')?.agent).toBeNull()

    detector.processSnapshot(new Map([['s1', 'claude']]))
    expect(changes).toHaveLength(1)

    detector.processSnapshot(new Map([['s1', null]]))
    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
    expect(changes[1]).not.toHaveProperty('pendingHint')
  })

  it('pty 数据到达：无 agent 不改状态；有 agent → working（只回调一次）；未知会话忽略', () => {
    detector.ptySpawned('s1')
    changes.length = 0
    detector.ptyData('s1')
    detector.ptyData('ghost')
    expect(changes).toEqual([])

    detector.processSnapshot(new Map([['s1', 'gemini']]))
    changes.length = 0
    detector.ptyData('s1')
    detector.ptyData('s1')
    expect(changes).toEqual([{ sessionId: 's1', alive: true, agent: 'gemini', status: 'working' }])
  })

  it('静默末尾报告：无 agent 时只更新 cwdNow、不改状态；解析不到提示符时保留上次的 cwdNow', () => {
    detector.ptySpawned('s1')
    changes.length = 0
    detector.reportOutput('s1', { tail: ['Allow execution?'], silentMs: 1500 }, 'cmd.exe')
    expect(changes).toEqual([])

    detector.reportOutput('s1', { tail: ['C:\\Windows>'], silentMs: 1500 }, 'cmd.exe')
    expect(changes).toEqual([
      { sessionId: 's1', alive: true, agent: null, status: 'idle', cwdNow: 'C:\\Windows' },
    ])
    detector.reportOutput('s1', { tail: ['C:\\Windows>'], silentMs: 1500 }, 'cmd.exe')
    expect(changes).toHaveLength(1)
    detector.reportOutput('s1', { tail: ['no prompt here'], silentMs: 1500 }, 'cmd.exe')
    expect(changes).toHaveLength(1)
    expect(detector.list()[0]?.cwdNow).toBe('C:\\Windows')
  })

  it('有 agent：末行命中提示 → blocked + pendingHint；静默无提示时 idle 保持 idle、working / blocked 未被查看 → done（清提示）、正被查看 → idle；done 被查看 → idle', () => {
    detector.ptySpawned('s1')
    detector.processSnapshot(new Map([['s1', 'pi']]))
    changes.length = 0

    // 空闲的 agent 静默不会变成「已完成」
    detector.reportOutput('s1', { tail: ['ready.'], silentMs: 1500 }, 'cmd.exe')
    expect(changes).toEqual([])

    detector.ptyData('s1')
    detector.reportOutput(
      's1',
      { tail: ['Do you want to proceed? (y/n)'], silentMs: 1500 },
      'cmd.exe',
    )
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'pi',
      status: 'blocked',
      pendingHint: 'Do you want to proceed? (y/n)',
    })

    // 用户回答后输出恢复 → working，提示清掉
    detector.ptyData('s1')
    expect(changes.at(-1)).toEqual({ sessionId: 's1', alive: true, agent: 'pi', status: 'working' })

    // 跑完静默且没人看 → done
    detector.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 }, 'cmd.exe')
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    expect(changes.at(-1)).not.toHaveProperty('pendingHint')
    // 再静默一次不重复回调
    const count = changes.length
    detector.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 }, 'cmd.exe')
    expect(changes).toHaveLength(count)

    // 被查看 → idle
    detector.setViewed('s1')
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })

    // 正被查看时跑完 → 直接 idle
    detector.ptyData('s1')
    detector.reportOutput('s1', { tail: ['Done again.'], silentMs: 1500 }, 'cmd.exe')
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
    detector.setViewed(null)
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
  })

  it('Claude hooks：UserPromptSubmit → working；Notification 四种类型 → blocked + message（截断 200）；其他类型忽略；Stop → 被查看 idle / 否则 done；SessionStart 记 claude；SessionEnd 清 agent 回 idle', () => {
    detector.ptySpawned('s1')
    changes.length = 0
    const hook = (payload: Record<string, unknown>): void =>
      detector.hookEvent(['s1'], 'claude', payload)

    hook({ hook_event_name: 'SessionStart' })
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'idle',
    })
    hook({ hook_event_name: 'UserPromptSubmit' })
    expect(changes.at(-1)).toMatchObject({ status: 'working' })

    for (const type of [
      'permission_prompt',
      'elicitation_dialog',
      'elicitation_url_dialog',
      'agent_needs_input',
    ]) {
      hook({ hook_event_name: 'UserPromptSubmit' })
      hook({ hook_event_name: 'Notification', notification_type: type, message: `need ${type}` })
      expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: `need ${type}` })
    }
    const count = changes.length
    hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'x' })
    hook({ hook_event_name: 'PreToolUse' })
    expect(changes).toHaveLength(count)

    hook({ hook_event_name: 'UserPromptSubmit' })
    hook({
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'm'.repeat(500),
    })
    expect((changes.at(-1) as SessionRuntime).pendingHint).toHaveLength(200)

    hook({ hook_event_name: 'Stop' })
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    expect(changes.at(-1)).not.toHaveProperty('pendingHint')
    detector.setViewed('s1')
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
    hook({ hook_event_name: 'UserPromptSubmit' })
    hook({ hook_event_name: 'Stop' })
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })

    hook({ hook_event_name: 'UserPromptSubmit' })
    hook({ hook_event_name: 'SessionEnd' })
    expect(changes.at(-1)).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
    hook({ hook_event_name: 'Stop' }) // 没有 agent 了：忽略
    expect(changes.at(-1)).toMatchObject({ agent: null, status: 'idle' })
  })

  it('Codex hooks：UserPromptSubmit → working；PermissionRequest → blocked（tool_input.description 优先，其次 tool_name）；Interrupt → idle；Stop / SessionStart / SessionEnd 同 Claude；多会话同时命中各自转移', () => {
    detector.ptySpawned('s1')
    detector.ptySpawned('s2')
    changes.length = 0

    detector.hookEvent(['s1', 's2'], 'codex', { hook_event_name: 'SessionStart' })
    expect(detector.list().map((r) => r.agent)).toEqual(['codex', 'codex'])
    detector.hookEvent(['s1'], 'codex', { hook_event_name: 'UserPromptSubmit' })
    expect(changes.at(-1)).toMatchObject({ sessionId: 's1', status: 'working' })
    detector.hookEvent(['s1'], 'codex', {
      hook_event_name: 'PermissionRequest',
      tool_name: 'shell',
      tool_input: { description: 'run npm test' },
    })
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'run npm test' })
    detector.hookEvent(['s1'], 'codex', {
      hook_event_name: 'PermissionRequest',
      tool_name: 'shell',
    })
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'shell' })
    detector.hookEvent(['s1'], 'codex', { hook_event_name: 'Interrupt' })
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
    expect(changes.at(-1)).not.toHaveProperty('pendingHint')

    detector.hookEvent(['s1'], 'codex', { hook_event_name: 'UserPromptSubmit' })
    detector.hookEvent(['s1'], 'codex', { hook_event_name: 'Stop', last_assistant_message: 'ok' })
    expect(changes.at(-1)).toMatchObject({ sessionId: 's1', status: 'done' })
    detector.hookEvent(['s2'], 'codex', { hook_event_name: 'SessionEnd' })
    expect(changes.at(-1)).toEqual({ sessionId: 's2', alive: true, agent: null, status: 'idle' })
    detector.hookEvent(['ghost'], 'codex', { hook_event_name: 'UserPromptSubmit' })
    detector.hookEvent([], 'codex', { hook_event_name: 'UserPromptSubmit' })
    detector.hookEvent(['s1'], 'codex', {})
    expect(changes.at(-1)).toMatchObject({ sessionId: 's2' })
  })

  it('hooks 抑制窗：收到 hook 后 30 s 内，pty 数据与静默报告都不改状态（cwdNow 照常）；30 s 后恢复', () => {
    detector.ptySpawned('s1')
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'SessionStart' })
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'UserPromptSubmit' })
    changes.length = 0

    detector.reportOutput('s1', { tail: ['Allow?'], silentMs: 1500 }, 'cmd.exe')
    expect(changes).toEqual([])
    detector.reportOutput('s1', { tail: ['C:\\p>'], silentMs: 1500 }, 'cmd.exe')
    expect(changes.at(-1)).toMatchObject({ status: 'working', cwdNow: 'C:\\p' })
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'Stop' })
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    detector.ptyData('s1')
    expect(changes.at(-1)).toMatchObject({ status: 'done' })

    now += 29_000
    detector.ptyData('s1')
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    now += 2_000
    detector.ptyData('s1')
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    detector.reportOutput('s1', { tail: ['Allow?'], silentMs: 1500 }, 'cmd.exe')
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'Allow?' })
  })
})
