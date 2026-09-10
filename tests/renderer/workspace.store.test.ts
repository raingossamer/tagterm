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

  it('closeTab 关闭当前页时激活 min(i, len-1) 位置的邻居；关闭非当前页不改 active；全关回到空状态', () => {
    const ws = useWorkspaceStore()
    ws.select('a')
    ws.select('b')
    ws.select('c')
    ws.select('b')

    ws.closeTab('b')
    expect(ws.openTabs).toEqual(['a', 'c'])
    expect(ws.activeId).toBe('c')

    ws.closeTab('a')
    expect(ws.activeId).toBe('c')

    ws.closeTab('c')
    expect(ws.openTabs).toEqual([])
    expect(ws.activeId).toBeNull()
  })

  it('onSessionRemoved 等同关闭其标签页', () => {
    const ws = useWorkspaceStore()
    ws.select('a')
    ws.select('b')

    ws.onSessionRemoved('b')
    expect(ws.openTabs).toEqual(['a'])
    expect(ws.activeId).toBe('a')
  })

  it('toggleSide 切换侧栏收起状态', () => {
    const ws = useWorkspaceStore()
    expect(ws.sideHidden).toBe(false)
    ws.toggleSide()
    expect(ws.sideHidden).toBe(true)
    ws.toggleSide()
    expect(ws.sideHidden).toBe(false)
  })

  it('每会话运行态：默认存活；setExited 记录退出码；markAlive 恢复', () => {
    const ws = useWorkspaceStore()
    expect(ws.isAlive('a')).toBe(true)

    ws.setExited('a', 3)
    expect(ws.isAlive('a')).toBe(false)
    expect(ws.runtime['a']).toEqual({ alive: false, exitCode: 3 })

    ws.markAlive('a')
    expect(ws.isAlive('a')).toBe(true)
  })
})
