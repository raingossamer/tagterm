import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import type { SessionRuntime } from '@shared/models'
import { AgentSubsystem } from '../../src/main/agent/AgentSubsystem'
import type { ProcessNode } from '../../src/main/agent/processMatch'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { waitFor } from './helpers'

/**
 * 边界测试：只经 AgentSubsystem 的公共接口与注入的假件（broadcast 数组、假子树、假定时器 / 时钟）断言，
 * 不碰 AgentDetector / ProcessTreeProbe 等内部协作者。
 */
describe('AgentSubsystem（主进程 agent 运行时子系统）', () => {
  let changes: SessionRuntime[]
  let subtrees: Map<number, ProcessNode[]>
  let queried: number[]
  let pending: Array<() => void>
  let now: number
  let agent: AgentSubsystem
  let pty: PtyManager | null

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  /** 触发一轮探针扫描（假定时器） */
  async function tick(): Promise<void> {
    const fns = pending.splice(0)
    for (const fn of fns) fn()
    await flush()
  }
  const runtimeOf = (id: string): SessionRuntime | undefined =>
    agent.list().find((r) => r.sessionId === id)

  beforeEach(() => {
    changes = []
    subtrees = new Map()
    queried = []
    pending = []
    now = 1_000_000
    pty = null
    agent = new AgentSubsystem({
      sessions: () => [],
      broadcast: (r) => changes.push(r),
      listSubtree: async (pid) => {
        queried.push(pid)
        return subtrees.get(pid) ?? []
      },
      now: () => now,
      timers: {
        setTimer: (fn) => {
          pending.push(fn)
          return fn
        },
        clearTimer: (handle) => {
          const i = pending.indexOf(handle as () => void)
          if (i >= 0) pending.splice(i, 1)
        },
      },
    })
  })

  afterEach(() => {
    pty?.killAll()
    agent.stop()
  })

  it('wrapPty 接上真 PtyManager：spawn 后出现空闲记录并开始探测该 pid；退出后先调用方 onExit、再墓碑广播，探针不再查询', async () => {
    const events: string[] = []
    pty = new PtyManager(
      agent.wrapPty({
        onData: () => {},
        onExit: (e) => {
          events.push(`exit:${e.sessionId}`)
          // 调用方的 onExit 先于状态机：此时记录还在
          expect(runtimeOf(e.sessionId)).toBeDefined()
        },
        isFile: existsSync,
      }),
    )
    const { pid } = pty.spawn('s1', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })
    expect(runtimeOf('s1')).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
    expect(changes).toEqual([{ sessionId: 's1', alive: true, agent: null, status: 'idle' }])

    await tick()
    expect(queried).toEqual([pid])

    await pty.killAndWait('s1')
    await waitFor(() => changes.length === 2)
    expect(events).toEqual(['exit:s1'])
    expect(changes[1]).toEqual({ sessionId: 's1', alive: false, agent: null, status: 'idle' })
    expect(agent.list()).toEqual([])

    await tick()
    expect(queried).toEqual([pid]) // 探针已停：没有下一轮
  })

  it('进程树发现 claude → 记 agent；随后有输出到达 → working；工具退出（子树清空）→ idle 且不留提示', async () => {
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    wrapped.onSpawn?.('s1', 100)
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'claude.exe' }])
    await tick()
    expect(runtimeOf('s1')).toMatchObject({ agent: 'claude', status: 'idle' })

    wrapped.onData('s1', 'x')
    expect(runtimeOf('s1')).toMatchObject({ agent: 'claude', status: 'working' })
    expect(changes.at(-1)).toMatchObject({ sessionId: 's1', status: 'working' })

    subtrees.set(100, [])
    await tick()
    expect(runtimeOf('s1')).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
  })

  it('静默末尾报告不再带 shell：无 agent 只更新 cwdNow；有 agent 末行提示 → blocked + 提示；跑完 → done，被查看 → idle；会话移除 → 墓碑', async () => {
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    wrapped.onSpawn?.('s1', 100)
    agent.reportOutput('s1', { tail: ['Allow execution?', 'PS C:\\repo>'], silentMs: 1500 })
    expect(runtimeOf('s1')).toEqual({
      sessionId: 's1',
      alive: true,
      agent: null,
      status: 'idle',
      cwdNow: 'C:\\repo',
    })

    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'codex.exe' }])
    await tick()
    wrapped.onData('s1', 'x')
    agent.reportOutput('s1', { tail: ['Do you want to proceed? (y/n)'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({
      status: 'blocked',
      pendingHint: 'Do you want to proceed? (y/n)',
    })

    wrapped.onData('s1', 'y')
    agent.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({ status: 'done' })
    agent.setViewed('s1')
    expect(runtimeOf('s1')).toMatchObject({ status: 'idle' })
    expect(runtimeOf('s1')).not.toHaveProperty('pendingHint')

    agent.reportOutput('ghost', { tail: ['Allow?'], silentMs: 1500 }) // 未知会话忽略
    const count = changes.length
    agent.sessionRemoved('s1')
    expect(agent.list()).toEqual([])
    expect(changes).toHaveLength(count + 1)
    expect(changes.at(-1)).toEqual({ sessionId: 's1', alive: false, agent: null, status: 'idle' })
  })

  it('isShellIdle：有子进程为假、没有为真；查询抛错（pid 已不存在）按空闲处理而不是把原生错误抛出去', async () => {
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'ping.exe' }])
    await expect(agent.isShellIdle(100)).resolves.toBe(false)
    await expect(agent.isShellIdle(200)).resolves.toBe(true)

    const failing = new AgentSubsystem({
      sessions: () => [],
      broadcast: () => {},
      listSubtree: async () => {
        throw new Error('boom')
      },
    })
    await expect(failing.isShellIdle(100)).resolves.toBe(true)
    failing.stop()
  })
})
