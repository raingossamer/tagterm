import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentKind, SessionRuntime } from '@shared/models'
import { AgentDetector } from '../../src/main/agent/AgentDetector'
import { HOOK_CONTRACTS } from '../../src/main/agent/hookContract'

/** Claude 哪些通知类型算「等你确认」以契约表为准（一致性由 hookContract.test 守） */
const CLAUDE_BLOCKING_TYPES = HOOK_CONTRACTS.claude.events
  .find((e) => e.event === 'Notification')!
  .matcher!.split('|')

/** 工具正在干活的一屏：状态行括号里带计时器（Claude Code 2.1.258 实测形态）；s 递增即「计时器在走」 */
const busy = (s: number, silentMs = 0): { tail: string[]; silentMs: number } => ({
  tail: [`✻ Cogitating… (${s}s · ↓ 1.2k tokens)`, '> ', '? for shortcuts'],
  silentMs,
})

/** 重试横幅的一屏（claude-code 2.1.258 实测形态）：s 递减即「倒数在走」；给 elapsed 时状态行的计时器也在走 */
const retrying = (
  s: number,
  elapsed?: number,
  silentMs = 0,
): { tail: string[]; silentMs: number } => ({
  tail: [
    ...(elapsed === undefined ? [] : [`✻ Cogitating… (${elapsed}s · ↓ 1.2k tokens)`]),
    `Connection error. · Retrying in ${s}s · attempt 2/10`,
    '> ',
  ],
  silentMs,
})
const retryHint = (s: number): string => `Connection error. · Retrying in ${s}s · attempt 2/10`

/** 进程树快照里的一个会话：工具（认不出为 null）与 shell 下在跑的程序名（缺省 null：多数用例只关心 agent） */
const inTree = (
  agent: AgentKind | null,
  program: string | null = null,
): { agent: AgentKind | null; program: string | null } => ({ agent, program })

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
        ['s1', inTree('claude', null)],
        ['ghost', inTree('pi')],
      ]),
    )
    expect(changes).toEqual([{ sessionId: 's1', alive: true, agent: 'claude', status: 'idle' }])
    expect(detector.list().find((r) => r.sessionId === 's2')?.agent).toBeNull()

    detector.processSnapshot(new Map([['s1', inTree('claude', null)]]))
    expect(changes).toHaveLength(1)

    detector.processSnapshot(new Map([['s1', inTree(null)]]))
    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
    expect(changes[1]).not.toHaveProperty('pendingHint')
  })

  it('屏幕在动的报告（silentMs 0）：无 agent 只更新 cwdNow；有 agent 时第一份采样只作基线、计时器往前走才 → working（同状态只回调一次）；读数不动（欢迎画面 / 打字 / 静态文字）不转移；未知会话忽略', () => {
    detector.ptySpawned('s1')
    changes.length = 0
    detector.reportOutput('s1', busy(1))
    detector.reportOutput('s1', busy(2))
    detector.reportOutput('ghost', busy(3))
    expect(changes).toEqual([]) // 没有 agent：计时器走着也不算
    detector.reportOutput('s1', { tail: ['C:\\Windows>claude'], silentMs: 0 })
    expect(changes).toEqual([
      { sessionId: 's1', alive: true, agent: null, status: 'idle', cwdNow: 'C:\\Windows' },
    ])

    detector.processSnapshot(new Map([['s1', inTree('gemini')]]))
    changes.length = 0
    // 欢迎画面 / 在工具里打字：屏幕在动但没有计时器 → 不算运行中
    detector.reportOutput('s1', { tail: ['Welcome to Gemini CLI', '> 正在打字'], silentMs: 0 })
    expect(changes).toEqual([])
    detector.reportOutput('s1', busy(10)) // 第一份带计时器的采样只作基线
    expect(changes).toEqual([])
    detector.reportOutput('s1', busy(11))
    detector.reportOutput('s1', busy(12))
    expect(changes).toEqual([
      {
        sessionId: 's1',
        alive: true,
        agent: 'gemini',
        status: 'working',
        cwdNow: 'C:\\Windows',
      },
    ])
    // 读数一动不动：屏幕上只是静态地印着一行带 (12s) 的文字
    detector.reportOutput('s1', busy(12))
    expect(changes).toHaveLength(1)
  })

  it('静默末尾报告：无 agent 时只更新 cwdNow、不改状态；解析不到提示符时保留上次的 cwdNow', () => {
    detector.ptySpawned('s1')
    changes.length = 0
    detector.reportOutput('s1', { tail: ['Allow execution?'], silentMs: 1500 })
    expect(changes).toEqual([])

    detector.reportOutput('s1', { tail: ['C:\\Windows>'], silentMs: 1500 })
    expect(changes).toEqual([
      { sessionId: 's1', alive: true, agent: null, status: 'idle', cwdNow: 'C:\\Windows' },
    ])
    detector.reportOutput('s1', { tail: ['C:\\Windows>'], silentMs: 1500 })
    expect(changes).toHaveLength(1)
    detector.reportOutput('s1', { tail: ['no prompt here'], silentMs: 1500 })
    expect(changes).toHaveLength(1)
    expect(detector.list()[0]?.cwdNow).toBe('C:\\Windows')
  })

  it('有 agent 的静默报告：末行命中提示 → blocked + pendingHint（屏幕在动时不判，重绘中途的一帧不算等人）；计时器还在走 → 仍 working（不算跑完）；计时器停了且此前 working / blocked → 未被查看 done（清提示）、正被查看 idle；idle 永不变 done；done 被查看 → idle', () => {
    detector.ptySpawned('s1')
    detector.processSnapshot(new Map([['s1', inTree('pi')]]))
    changes.length = 0

    // 空闲的 agent 静默不会变成「已完成」
    detector.reportOutput('s1', { tail: ['ready.'], silentMs: 1500 })
    expect(changes).toEqual([])

    detector.reportOutput('s1', busy(5))
    detector.reportOutput('s1', busy(6))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    expect(changes).toHaveLength(1)
    // 静默了但计时器还在往前走（工具在想，屏幕一时没动静）：仍是 working，不算跑完
    detector.reportOutput('s1', busy(8, 1500))
    expect(detector.list()[0]).toMatchObject({ status: 'working' })
    expect(changes).toHaveLength(1)

    // 屏幕在动时末行有提示模式：先不判（重绘中途的一帧）；静默下来才算「等你确认」
    detector.reportOutput('s1', { tail: ['Do you want to proceed? (y/n)'], silentMs: 0 })
    expect(changes).toHaveLength(1)
    detector.reportOutput('s1', { tail: ['Do you want to proceed? (y/n)'], silentMs: 1500 })
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'pi',
      status: 'blocked',
      pendingHint: 'Do you want to proceed? (y/n)',
    })

    // 用户回答后工具继续干活（计时器又走起来）→ working，提示清掉
    detector.reportOutput('s1', busy(20))
    detector.reportOutput('s1', busy(21))
    expect(changes.at(-1)).toEqual({ sessionId: 's1', alive: true, agent: 'pi', status: 'working' })

    // 跑完：状态行换成「Cooked for 21s · done」（耗时不在括号里 → 计时器读数消失）且静默、没人看 → done
    const finished = { tail: ['✻ Cooked for 21s · done 13:57', '> '], silentMs: 1500 }
    detector.reportOutput('s1', finished)
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    expect(changes.at(-1)).not.toHaveProperty('pendingHint')
    // 再静默一次不重复回调；屏幕在动但计时器没动（用户在打字）也不动
    const count = changes.length
    detector.reportOutput('s1', finished)
    detector.reportOutput('s1', { tail: ['> 下一个问题'], silentMs: 0 })
    expect(changes).toHaveLength(count)

    // 被查看 → idle
    detector.setViewed('s1')
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })

    // 正被查看时跑完 → 直接 idle
    detector.reportOutput('s1', busy(30))
    detector.reportOutput('s1', busy(31))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    detector.reportOutput('s1', { tail: ['Done again.'], silentMs: 1500 })
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
    detector.setViewed(null)
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })

    // 用户拒绝、工具停下：blocked → 静默且计时器不动 → done
    detector.reportOutput('s1', busy(40))
    detector.reportOutput('s1', busy(41))
    detector.reportOutput('s1', { tail: ['Allow?'], silentMs: 1500 })
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'Allow?' })
    detector.reportOutput('s1', { tail: ['Stopped.'], silentMs: 1500 })
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    expect(changes.at(-1)).not.toHaveProperty('pendingHint')
  })

  it('采样被节流（窗口隐藏，报告一分钟才来一份）：计时器前进约等于两份报告之间实际过去的时间 → working；静态读数隔多久都不算', () => {
    detector.ptySpawned('s1')
    detector.processSnapshot(new Map([['s1', inTree('claude')]]))
    changes.length = 0

    detector.reportOutput('s1', busy(100))
    now += 60_000
    detector.reportOutput('s1', busy(100)) // 一分钟后读数没变：静态文字
    expect(changes).toEqual([])
    now += 60_000
    detector.reportOutput('s1', busy(160))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
  })

  it('重试横幅：有 agent 且倒数在走 → blocked、提示 = 横幅那一行（两种报告都认，从 working / idle 都转）；同屏计时器也在走时倒数优先；静态引用的横幅不转移；倒数还在屏上时不放行；倒数消失后计时器走起来 → working（清提示）、静默 → done / idle', () => {
    detector.ptySpawned('s1')
    detector.processSnapshot(new Map([['s1', inTree('claude')]]))
    changes.length = 0

    // 静态引用：聊天里印着一句横幅，两份采样读数一样 → 不是在倒数
    const quoted = { tail: ['解释一下 Retrying in 5s 这句是什么意思', '> '], silentMs: 0 }
    detector.reportOutput('s1', quoted)
    detector.reportOutput('s1', quoted)
    expect(changes).toEqual([])

    // 工作中 → 断网：倒数 5s → 4s，同屏的计时器也在走（20s → 21s），倒数优先 → blocked
    detector.reportOutput('s1', busy(10))
    detector.reportOutput('s1', busy(11))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    detector.reportOutput('s1', retrying(5, 20))
    detector.reportOutput('s1', retrying(4, 21))
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'blocked',
      pendingHint: retryHint(4),
    })
    // 倒数还在屏上、这一秒采样读数没变（抖动）：仍 blocked，不因计时器在走而放行
    const count = changes.length
    detector.reportOutput('s1', retrying(4, 22))
    expect(detector.list()[0]).toMatchObject({ status: 'blocked', pendingHint: retryHint(4) })
    expect(changes).toHaveLength(count)
    // 重试成功：横幅消失、计时器继续走 → working，提示清掉
    detector.reportOutput('s1', busy(23))
    detector.reportOutput('s1', busy(24))
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'working',
    })

    // 静默报告也认倒数；从 idle 也转
    detector.reportOutput('s1', { tail: ['✻ Cooked for 24s · done 13:57', '> '], silentMs: 1500 })
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    detector.setViewed('s1')
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
    detector.reportOutput('s1', retrying(8, undefined, 1500))
    detector.reportOutput('s1', retrying(7, undefined, 1500))
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: retryHint(7) })
    // 用户按 Esc 中断：横幅消失、屏幕静默、计时器没动 → 正被查看 → idle，提示清掉
    detector.reportOutput('s1', {
      tail: ['Interrupted · What should Claude do instead?', '> '],
      silentMs: 1500,
    })
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
    expect(changes.at(-1)).not.toHaveProperty('pendingHint')
  })

  it('抑制窗例外：hooks 事件后 30 s 内倒数照样 → blocked，从这种 blocked 离开也不受抑制；释放后回到常规抑制；任一 hooks 事件撤销例外', () => {
    detector.ptySpawned('s1')
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'SessionStart' })
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'UserPromptSubmit' })
    changes.length = 0

    // 提问 5 s 后断网：倒数 → blocked，不等 30 s
    now += 5_000
    detector.reportOutput('s1', retrying(5, 20))
    detector.reportOutput('s1', retrying(4, 21))
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: retryHint(4) })
    // 仍在窗内：重试成功、计时器走起来 → working（释放同样不受抑制）
    now += 3_000
    detector.reportOutput('s1', busy(22))
    detector.reportOutput('s1', busy(23))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    expect(changes.at(-1)).not.toHaveProperty('pendingHint')
    // 释放后回到常规：窗内的静默提示不再转移
    detector.reportOutput('s1', { tail: ['Allow?'], silentMs: 1500 })
    expect(detector.list()[0]).toMatchObject({ status: 'working' })

    // 再次断网 → blocked；此时 hooks 的 Notification 到达 → hooks 说了算（blocked + message），例外撤销
    detector.reportOutput('s1', retrying(9, 30))
    detector.reportOutput('s1', retrying(8, 31))
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: retryHint(8) })
    detector.hookEvent(['s1'], 'claude', {
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Allow smoke tool?',
    })
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'Allow smoke tool?' })
    // 撤销例外后，窗内计时器在走也不再放行
    detector.reportOutput('s1', busy(40))
    detector.reportOutput('s1', busy(41))
    expect(detector.list()[0]).toMatchObject({
      status: 'blocked',
      pendingHint: 'Allow smoke tool?',
    })
  })

  it('Claude hooks：UserPromptSubmit → working；Notification 契约表里的阻塞类型 → blocked + message（截断 200）；其他类型忽略；Stop → 被查看 idle / 否则 done；SessionStart 记 claude；SessionEnd 回 idle 但不动 agent（在不在由进程树说了算）', () => {
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

    for (const type of CLAUDE_BLOCKING_TYPES) {
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

    // 回合因 API 错误终止（网络断等）：Claude Code 发 StopFailure 而不是 Stop → 等你确认（黄），不是已完成（蓝）；
    // 正被查看也一样是 blocked（要人重发）；重新提问 → working 并清提示
    hook({ hook_event_name: 'UserPromptSubmit' })
    hook({
      hook_event_name: 'StopFailure',
      error: 'unknown',
      error_details: 'Connection lost mid-response. The response above may be incomplete.',
    })
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'blocked',
      pendingHint: 'Connection lost mid-response. The response above may be incomplete.',
    })
    hook({ hook_event_name: 'UserPromptSubmit' })
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'working',
    })

    hook({ hook_event_name: 'UserPromptSubmit' })
    hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'm' })
    hook({ hook_event_name: 'SessionEnd' })
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'idle',
    })
    // 工具真退出：进程树发现它没了才清 agent，之后的事件忽略
    detector.processSnapshot(new Map([['s1', inTree('claude')]]))
    detector.processSnapshot(new Map([['s1', inTree(null)]]))
    expect(changes.at(-1)).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
    hook({ hook_event_name: 'Stop' })
    expect(changes.at(-1)).toMatchObject({ agent: null, status: 'idle' })
  })

  it('/clear 连发 SessionEnd 与 SessionStart（两条都是异步 hook）：到达顺序颠倒也不影响，之后提问照样 → working', () => {
    detector.ptySpawned('s1')
    detector.processSnapshot(new Map([['s1', inTree('claude')]]))
    const hook = (event: string): void =>
      detector.hookEvent(['s1'], 'claude', { hook_event_name: event })

    hook('SessionStart')
    hook('SessionEnd') // 迟到的那一条
    expect(detector.list()[0]).toMatchObject({ agent: 'claude', status: 'idle' })
    hook('UserPromptSubmit')
    expect(detector.list()[0]).toMatchObject({ agent: 'claude', status: 'working' })
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
    detector.hookEvent(['s2'], 'codex', { hook_event_name: 'UserPromptSubmit' })
    detector.hookEvent(['s2'], 'codex', { hook_event_name: 'SessionEnd' })
    expect(changes.at(-1)).toEqual({ sessionId: 's2', alive: true, agent: 'codex', status: 'idle' })
    detector.hookEvent(['ghost'], 'codex', { hook_event_name: 'UserPromptSubmit' })
    detector.hookEvent([], 'codex', { hook_event_name: 'UserPromptSubmit' })
    detector.hookEvent(['s1'], 'codex', {})
    expect(changes.at(-1)).toMatchObject({ sessionId: 's2' })
  })

  it('回合结束后又接着干活（后台任务跑完把工具唤醒，没有新的提问）：Stop 后 30 s 内，已完成 / 空闲时计时器一走即 working', () => {
    detector.ptySpawned('s1')
    const hook = (event: string): void =>
      detector.hookEvent(['s1'], 'claude', { hook_event_name: event })
    hook('SessionStart')
    hook('UserPromptSubmit')
    hook('Stop')
    expect(changes.at(-1)).toMatchObject({ status: 'done' })

    detector.reportOutput('s1', busy(1)) // 第一份只作基线
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
    now += 1000
    detector.reportOutput('s1', busy(2))
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'working',
    })

    // 正被查看时结束的回合是 idle：同样一走就回 working
    detector.setViewed('s1')
    hook('Stop')
    expect(changes.at(-1)).toMatchObject({ status: 'idle' })
    now += 1000
    detector.reportOutput('s1', busy(3))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
  })

  it('静默时看走过的那个计时器还在不在屏幕上：还在（只是卡了一下）→ 不转移；状态行被换掉、读数消失 → 跑完', () => {
    detector.ptySpawned('s1')
    detector.processSnapshot(new Map([['s1', inTree('pi')]]))
    detector.reportOutput('s1', busy(39))
    detector.reportOutput('s1', busy(40))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    const count = changes.length

    // 屏幕停了 1.5 s，计时器原样停在 40s：工具还在干活，只是这一下没输出
    detector.reportOutput('s1', busy(40, 1500))
    expect(changes).toHaveLength(count)
    // 屏幕上别的静态时长文字不算数，只认走过的那个读数
    detector.reportOutput('s1', {
      tail: ['⏺ Bash(pnpm test) (timeout 2m 0s)', '✻ Cooked for 41s · done 13:57', '> '],
      silentMs: 1500,
    })
    expect(changes.at(-1)).toMatchObject({ status: 'done' })
  })

  it('收到过 hook 的会话，静默判跑完只在正被查看时生效：按 Esc 中断（没有 Stop，只可能发生在正看着的终端）→ 约 1.5 s 回 idle；没人看的会话只认 Stop —— 权限对话框的 Notification 要 6 s 后才来，期间屏幕与中断一模一样，不能先报一次已完成', () => {
    detector.ptySpawned('s1')
    const hook = (payload: Record<string, unknown>): void =>
      detector.hookEvent(['s1'], 'claude', payload)
    hook({ hook_event_name: 'SessionStart' })
    const interrupted = {
      tail: ['⎿ Interrupted · What should Claude do instead?', '> '],
      silentMs: 1500,
    }
    const dialog = { tail: ['Do you want to run this command?', '1. Yes'], silentMs: 1500 }
    const tickTwice = (): void => {
      detector.reportOutput('s1', busy(1))
      now += 1000
      detector.reportOutput('s1', busy(2))
      now += 1500
    }

    // 正被查看、刚提问、计时器还没走过：静默不判（提问后头一两秒屏幕上本来就没有计时器）
    detector.setViewed('s1')
    hook({ hook_event_name: 'UserPromptSubmit' })
    detector.reportOutput('s1', interrupted)
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    // 计时器走过、又从屏幕上消失：窗内也判跑完
    tickTwice()
    detector.reportOutput('s1', interrupted)
    expect(changes.at(-1)).toEqual({
      sessionId: 's1',
      alive: true,
      agent: 'claude',
      status: 'idle',
    })

    // 没人看：对话框盖住状态行，窗内窗外都不靠静默判跑完，等 hooks 开口
    detector.setViewed(null)
    hook({ hook_event_name: 'UserPromptSubmit' })
    tickTwice()
    detector.reportOutput('s1', dialog)
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    now += 31_000
    detector.reportOutput('s1', dialog)
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'm' })
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'm' })

    // 正被查看时，计时器走过之后才来的「等你确认」：hook 把走过的读数清掉，对话框盖住状态行不算跑完
    detector.setViewed('s1')
    hook({ hook_event_name: 'UserPromptSubmit' })
    tickTwice()
    hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'm' })
    detector.reportOutput('s1', dialog)
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'm' })
  })

  it('关掉某个工具的 hooks 开关后，它的会话不再算「收到过 hook」：没人看时又靠静默判跑完；别的工具的会话不受影响', () => {
    detector.ptySpawned('s1')
    detector.ptySpawned('s2')
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'SessionStart' })
    detector.hookEvent(['s2'], 'codex', { hook_event_name: 'SessionStart' })
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'UserPromptSubmit' })
    detector.hookEvent(['s2'], 'codex', { hook_event_name: 'UserPromptSubmit' })
    const finished = { tail: ['✻ Cooked for 3s · done 13:57', '> '], silentMs: 1500 }

    detector.hooksDisabled('claude')
    detector.reportOutput('s1', finished)
    detector.reportOutput('s2', finished)
    expect(detector.list()).toMatchObject([
      { sessionId: 's1', status: 'done' },
      { sessionId: 's2', status: 'working' },
    ])
  })

  it('hooks 抑制窗：收到 hook 后 30 s 内，末行提示与没见过计时器走的静默都不改状态（cwdNow 照常）；等你确认在窗内计时器在走也不放行；30 s 后恢复', () => {
    detector.ptySpawned('s1')
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'SessionStart' })
    detector.hookEvent(['s1'], 'claude', { hook_event_name: 'UserPromptSubmit' })
    changes.length = 0

    detector.reportOutput('s1', { tail: ['Allow?'], silentMs: 1500 })
    expect(changes).toEqual([])
    detector.reportOutput('s1', { tail: ['C:\\p>'], silentMs: 1500 })
    expect(changes.at(-1)).toMatchObject({ status: 'working', cwdNow: 'C:\\p' })
    // 等你确认：窗内计时器在走也不放行 —— 权限对话框期间计时器是否还在跳没核实，不能把刚变黄的提醒冲掉
    detector.hookEvent(['s1'], 'claude', {
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'm',
    })
    expect(changes.at(-1)).toMatchObject({ status: 'blocked' })
    detector.reportOutput('s1', busy(1))
    detector.reportOutput('s1', busy(2))
    expect(changes.at(-1)).toMatchObject({ status: 'blocked' })

    now += 29_000
    detector.reportOutput('s1', busy(3))
    expect(changes.at(-1)).toMatchObject({ status: 'blocked' })
    now += 2_000
    detector.reportOutput('s1', busy(4))
    expect(changes.at(-1)).toMatchObject({ status: 'working' })
    detector.reportOutput('s1', { tail: ['Allow?'], silentMs: 1500 })
    expect(changes.at(-1)).toMatchObject({ status: 'blocked', pendingHint: 'Allow?' })
  })
})
