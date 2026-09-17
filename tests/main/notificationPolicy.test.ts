import { describe, expect, it } from 'vitest'
import type { SessionRuntime } from '@shared/models'
import { decideNotification } from '../../src/main/agent/notificationPolicy'

const rt = (partial: Partial<SessionRuntime>): SessionRuntime => ({
  sessionId: 's1',
  alive: true,
  agent: 'claude',
  status: 'idle',
  ...partial,
})

describe('decideNotification（通知去重与文案，纯函数）', () => {
  it('进入 blocked 且不是正被查看 → 「<名> 等你确认」，正文是提示；正被查看 → 不通知', () => {
    expect(
      decideNotification('working', rt({ status: 'blocked', pendingHint: 'Allow?' }), false, 'api'),
    ).toEqual({ title: 'api 等你确认', body: 'Allow?' })
    expect(decideNotification('working', rt({ status: 'blocked' }), false, 'api')).toEqual({
      title: 'api 等你确认',
      body: '',
    })
    expect(decideNotification('working', rt({ status: 'blocked' }), true, 'api')).toBeNull()
  })

  it('同一状态重复变化只通知一次；离开后再进入再通知；进入 done 一律「<名> 完成」；其他状态不通知', () => {
    expect(
      decideNotification('blocked', rt({ status: 'blocked', pendingHint: 'x' }), false, 'api'),
    ).toBeNull()
    expect(decideNotification('working', rt({ status: 'blocked' }), false, 'api')).not.toBeNull()
    expect(decideNotification('blocked', rt({ status: 'done' }), false, 'api')).toEqual({
      title: 'api 完成',
      body: '',
    })
    expect(decideNotification('done', rt({ status: 'done' }), false, 'api')).toBeNull()
    expect(decideNotification(null, rt({ status: 'done' }), true, 'api')).toEqual({
      title: 'api 完成',
      body: '',
    })
    expect(decideNotification('blocked', rt({ status: 'working' }), false, 'api')).toBeNull()
    expect(decideNotification('done', rt({ status: 'idle' }), false, 'api')).toBeNull()
    expect(decideNotification(null, rt({ status: 'idle' }), false, 'api')).toBeNull()
  })
})
