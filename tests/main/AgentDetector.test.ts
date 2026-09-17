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
})
