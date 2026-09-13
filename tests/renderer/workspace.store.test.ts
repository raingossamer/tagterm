import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useWorkspaceStore } from '../../src/renderer/src/stores/workspace'
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

  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionsStore().sessions = [a, b]
    pty = new FakePty()
    core = new TerminalWorkspace({
      pty,
      createTerminal: () => new FakeTerminal(),
      raf: (fn) => fn(),
    })
  })

  it('attachCore 后镜像核心快照；select / closeTab 委托到核心，openTabs / activeId / runtime 随之变化', async () => {
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
  })

  it('未 attachCore 时 select / closeTab 无副作用', async () => {
    const ws = useWorkspaceStore()
    await ws.select(a.id)
    ws.closeTab(a.id)
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
