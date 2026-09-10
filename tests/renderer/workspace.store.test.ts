import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from '../../src/renderer/src/stores/workspace'

describe('workspace store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('select 把会话设为 active 并加入标签页，重复选择不重复加入', () => {
    const ws = useWorkspaceStore()
    ws.select('a')
    ws.select('b')
    ws.select('a')

    expect(ws.activeId).toBe('a')
    expect(ws.openTabs).toEqual(['a', 'b'])
    expect(ws.isOpen('b')).toBe(true)
  })

  it('onSessionRemoved 关闭其标签页；移除的是当前会话时切到邻居，全空回到空状态', () => {
    const ws = useWorkspaceStore()
    ws.select('a')
    ws.select('b')
    ws.select('c')
    ws.select('b')

    ws.onSessionRemoved('b')
    expect(ws.openTabs).toEqual(['a', 'c'])
    expect(ws.activeId).toBe('c')

    ws.onSessionRemoved('c')
    expect(ws.activeId).toBe('a')

    ws.onSessionRemoved('a')
    expect(ws.openTabs).toEqual([])
    expect(ws.activeId).toBeNull()
  })
})
