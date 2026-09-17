import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SessionRuntime } from '@shared/models'
import { useAgentStore } from '../../src/renderer/src/stores/agent'
import { installFakeApi } from './fakeApi'

describe('agent store（运行时状态镜像）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('load() 镜像 agent:list 并订阅 agent:status 逐条替换；statusOf 未知为 idle；countBy / blockedCount 按状态计数；alive 为 false 即删记录', async () => {
    let broadcast: ((r: SessionRuntime) => void) | undefined
    installFakeApi({
      agent: {
        list: async () => [
          { sessionId: 'a', alive: true, agent: 'claude', status: 'working' },
          { sessionId: 'b', alive: true, agent: null, status: 'idle' },
        ],
        onStatus: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })
    const store = useAgentStore()
    expect(store.statusOf('a')).toBe('idle')
    await store.load()
    expect(store.statusOf('a')).toBe('working')
    expect(store.statusOf('b')).toBe('idle')
    expect(store.statusOf('ghost')).toBe('idle')
    expect(store.runtimeOf('a')).toEqual({
      sessionId: 'a',
      alive: true,
      agent: 'claude',
      status: 'working',
    })
    expect(store.runtimeOf('ghost')).toBeUndefined()

    broadcast!({ sessionId: 'b', alive: true, agent: 'codex', status: 'blocked', pendingHint: '?' })
    broadcast!({ sessionId: 'c', alive: true, agent: 'pi', status: 'blocked' })
    broadcast!({ sessionId: 'd', alive: true, agent: 'gemini', status: 'done' })
    expect(store.countBy('working')).toBe(1)
    expect(store.countBy('blocked')).toBe(2)
    expect(store.countBy('done')).toBe(1)
    expect(store.blockedCount).toBe(2)
    expect(store.runtimeOf('b')?.pendingHint).toBe('?')

    broadcast!({ sessionId: 'a', alive: false, agent: null, status: 'idle' })
    expect(store.runtimeOf('a')).toBeUndefined()
    expect(store.countBy('working')).toBe(0)
  })

  it('setViewed 只调 SDK', async () => {
    const api = installFakeApi()
    const store = useAgentStore()
    await store.setViewed('a')
    await store.setViewed(null)
    expect(api.agent.setViewed).toHaveBeenNthCalledWith(1, 'a')
    expect(api.agent.setViewed).toHaveBeenNthCalledWith(2, null)
  })
})
