import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { OPEN_TABS_STORAGE_KEY, useWorkspaceStore } from '../../src/renderer/src/stores/workspace'
import { useSessionsStore } from '../../src/renderer/src/stores/sessions'
import { TerminalWorkspace } from '../../src/renderer/src/terminal/TerminalWorkspace'
import { FakePty } from './fakePty'
import { FakeTerminal } from './fakeTerminal'
import { makeSession } from './fakeApi'

describe('workspace store（TerminalWorkspace 的薄适配器 + 纯 UI 状态）', () => {
  const a = makeSession({ name: 'a' })
  const b = makeSession({ name: 'b' })
  let pty: FakePty
  let core: TerminalWorkspace

  const c = makeSession({ name: 'c' })

  function makeCore(): TerminalWorkspace {
    pty = new FakePty()
    return new TerminalWorkspace({
      pty,
      createTerminal: () => new FakeTerminal(),
      raf: (fn) => fn(),
    })
  }

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useSessionsStore().sessions = [a, b]
    core = makeCore()
  })

  it('标签页与当前页随每次快照变化写入 localStorage；新 pinia + 新核心 restore() 后顺序与当前页一致，只有当前页 spawn', async () => {
    const ws = useWorkspaceStore()
    useSessionsStore().sessions = [a, b, c]
    ws.attachCore(core)
    await ws.select(a.id)
    await ws.select(b.id)
    await ws.select(c.id)
    await ws.select(b.id)
    expect(JSON.parse(localStorage.getItem(OPEN_TABS_STORAGE_KEY)!)).toEqual({
      ids: [a.id, b.id, c.id],
      activeId: b.id,
    })
    ws.closeTab(c.id)
    expect(JSON.parse(localStorage.getItem(OPEN_TABS_STORAGE_KEY)!)).toEqual({
      ids: [a.id, b.id],
      activeId: b.id,
    })

    // 重开：新 pinia、新核心、会话列表到位后 restore
    setActivePinia(createPinia())
    useSessionsStore().sessions = [a, b, c]
    const fresh = useWorkspaceStore()
    const freshCore = makeCore()
    fresh.attachCore(freshCore)
    await fresh.restore()
    expect(fresh.openTabs).toEqual([a.id, b.id])
    expect(fresh.activeId).toBe(b.id)
    expect(pty.opens.map((o) => o.sessionId)).toEqual([b.id])
    expect(fresh.phaseOf(a.id)).toBe('closed')
    expect(fresh.phaseOf(b.id)).toBe('running')
  })

  it('attachCore 后镜像核心快照；select / closeTab / restart 委托到核心，openTabs / activeId / runtime 随之变化', async () => {
    const ws = useWorkspaceStore()
    expect(ws.hasActive).toBe(false)
    ws.attachCore(core)

    await ws.select(a.id)
    await ws.select(b.id)
    expect(ws.openTabs).toEqual([a.id, b.id])
    expect(ws.activeId).toBe(b.id)
    expect(ws.hasActive).toBe(true)
    expect(ws.isOpen(a.id)).toBe(true)
    expect(ws.phaseOf(a.id)).toBe('running')
    expect(ws.phaseOf('ghost')).toBe('closed')
    expect(ws.runtime[b.id]).toEqual({ phase: 'running' })

    ws.closeTab(b.id)
    expect(ws.openTabs).toEqual([a.id])
    expect(ws.activeId).toBe(a.id)

    await ws.restart(b.id) // 重启：结束 → 重开并切过去
    expect(pty.kills).toEqual([b.id])
    expect(pty.spawnCount(b.id)).toBe(2)
    expect(ws.activeId).toBe(b.id)
  })

  it('localStorage 坏 JSON / 不是对象 / ids 不是数组 / 混入非字符串：restore() 不抛，无标签页、不 spawn', async () => {
    for (const raw of ['{ not json', '[1,2]', JSON.stringify({ ids: 'a', activeId: a.id })]) {
      localStorage.setItem(OPEN_TABS_STORAGE_KEY, raw)
      setActivePinia(createPinia())
      useSessionsStore().sessions = [a, b]
      const ws = useWorkspaceStore()
      ws.attachCore(makeCore())
      await expect(ws.restore()).resolves.toBeUndefined()
      expect(ws.openTabs).toEqual([])
      expect(ws.activeId).toBeNull()
      expect(pty.opens).toEqual([])
    }

    localStorage.setItem(
      OPEN_TABS_STORAGE_KEY,
      JSON.stringify({ ids: [a.id, 5, null, b.id], activeId: 7 }),
    )
    setActivePinia(createPinia())
    useSessionsStore().sessions = [a, b]
    const ws = useWorkspaceStore()
    ws.attachCore(makeCore())
    await ws.restore()
    expect(ws.openTabs).toEqual([a.id, b.id])
    expect(ws.activeId).toBeNull()
    expect(pty.opens).toEqual([])
  })

  it('上次开着的会话已被删除 → 静默跳过；当前页被删 → 不选中、不 spawn；未 attachCore 时 restore 无副作用', async () => {
    localStorage.setItem(
      OPEN_TABS_STORAGE_KEY,
      JSON.stringify({ ids: [a.id, c.id, b.id], activeId: c.id }),
    )
    setActivePinia(createPinia())
    useSessionsStore().sessions = [a, b] // c 已被删除
    const ws = useWorkspaceStore()
    ws.attachCore(makeCore())
    await ws.restore()
    expect(ws.openTabs).toEqual([a.id, b.id])
    expect(ws.activeId).toBeNull()
    expect(pty.opens).toEqual([])

    localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify({ ids: [a.id], activeId: a.id }))
    setActivePinia(createPinia())
    useSessionsStore().sessions = [a, b]
    const detached = useWorkspaceStore()
    await detached.restore()
    expect(detached.openTabs).toEqual([])
  })

  it('未 attachCore 时 select / closeTab / restart 无副作用', async () => {
    const ws = useWorkspaceStore()
    await ws.select(a.id)
    ws.closeTab(a.id)
    await ws.restart(a.id)
    expect(pty.kills).toEqual([])
    expect(ws.activeId).toBeNull()
    expect(pty.opens).toEqual([])
  })

  it('会话镜像变化喂给核心 syncSessions：列表少了已打开的会话 → 标签页关闭、activeId 为 null、运行态清除', async () => {
    const ws = useWorkspaceStore()
    ws.attachCore(core)
    await ws.select(a.id)

    useSessionsStore().sessions = [b]
    await nextTick()
    expect(ws.openTabs).toEqual([])
    expect(ws.activeId).toBeNull()
    expect(ws.phaseOf(a.id)).toBe('closed')
  })

  it('attachCore 返回的拆除函数：之后不再镜像快照、不再喂 syncSessions', async () => {
    const ws = useWorkspaceStore()
    const detach = ws.attachCore(core)
    await ws.select(a.id)
    detach()

    core.closeTab(a.id)
    expect(ws.activeId).toBe(a.id)
    useSessionsStore().sessions = []
    await nextTick()
    expect(core.snapshot().runtime[a.id]).toEqual({ phase: 'running' })
  })

  it('toggleSide / setHovered 是纯 UI 状态，不经核心', () => {
    const ws = useWorkspaceStore()
    expect(ws.sideHidden).toBe(false)
    ws.toggleSide()
    expect(ws.sideHidden).toBe(true)
    ws.setHovered(a.id)
    expect(ws.hoveredId).toBe(a.id)
    ws.setHovered(null)
    expect(ws.hoveredId).toBeNull()
  })
})
