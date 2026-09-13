import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalWorkspace,
  type WorkspaceSnapshot,
} from '../../src/renderer/src/terminal/TerminalWorkspace'
import { FakePty } from './fakePty'
import { FakeTerminal } from './fakeTerminal'
import { makeSession } from './fakeApi'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('TerminalWorkspace（会话生命周期核心）', () => {
  const a = makeSession({ name: 'a' })
  const b = makeSession({ name: 'b' })
  const c = makeSession({ name: 'c' })
  let pty: FakePty
  let terminals: FakeTerminal[]
  let container: HTMLElement
  let core: TerminalWorkspace

  function setup(opts: { manualOpen?: boolean } = {}): void {
    pty = new FakePty(opts)
    terminals = []
    container = document.createElement('div')
    core = new TerminalWorkspace({
      pty,
      createTerminal: () => {
        const t = new FakeTerminal()
        terminals.push(t)
        return t
      },
      raf: (fn) => fn(),
    })
    core.attach(container)
    core.syncSessions([a, b, c])
  }

  beforeEach(() => setup())

  it('1 select 未知 id：无标签页、无实例、pty.open 未调', async () => {
    await core.select('ghost')

    expect(core.snapshot()).toEqual({ openTabs: [], activeId: null, runtime: {} })
    expect(terminals).toHaveLength(0)
    expect(pty.opens).toEqual([])
  })

  it('2 select 新会话：加标签页并激活，phase opening → running；实例挂进容器并可见、focus 一次、WebGL 挂上；pty.open 按 fit 尺寸调一次', async () => {
    const pending = core.select(a.id)
    expect(core.snapshot()).toEqual({
      openTabs: [a.id],
      activeId: a.id,
      runtime: { [a.id]: { phase: 'opening' } },
    })

    await pending
    expect(core.snapshot().runtime[a.id]).toEqual({ phase: 'running' })
    expect(terminals).toHaveLength(1)
    const term = terminals[0]!
    expect(term.host?.parentElement).toBe(container)
    expect(term.isVisible).toBe(true)
    expect(term.focusCount).toBe(1)
    expect(term.isWebgl).toBe(true)
    expect(pty.opens).toEqual([{ sessionId: a.id, size: { cols: 80, rows: 24 }, created: true }])
    await flush()
    expect(pty.spawnCount(a.id)).toBe(1)
  })

  it('3 opening 期间重复 select、已运行再 select：不重复 pty.open、不重复加标签页，只切显示', async () => {
    setup({ manualOpen: true })
    const first = core.select(a.id)
    const second = core.select(a.id)
    expect(core.snapshot().openTabs).toEqual([a.id])
    expect(pty.opens).toHaveLength(1)
    expect(terminals).toHaveLength(1)

    pty.resolveOpens()
    await first
    await second
    expect(core.snapshot().runtime[a.id]).toEqual({ phase: 'running' })

    await core.select(a.id)
    expect(pty.opens).toHaveLength(1)
    expect(terminals).toHaveLength(1)
    expect(terminals[0]!.isVisible).toBe(true)
  })

  it('4 select 切换 a → b：只切 display、不重灌；WebGL 只在可见实例；pty 输出按 id 路由到各自实例', async () => {
    await core.select(a.id)
    await core.select(b.id)
    expect(core.snapshot()).toMatchObject({ openTabs: [a.id, b.id], activeId: b.id })
    expect(terminals[0]!.isVisible).toBe(false)
    expect(terminals[1]!.isVisible).toBe(true)
    expect(terminals[0]!.isWebgl).toBe(false)
    expect(terminals[1]!.isWebgl).toBe(true)

    pty.emitData(a.id, 'out-a')
    pty.emitData(b.id, 'out-b')
    pty.emitData('ghost', 'x')
    expect(terminals[0]!.written).toBe('out-a')
    expect(terminals[1]!.written).toBe('out-b')

    await core.select(a.id)
    expect(terminals[0]!.isVisible).toBe(true)
    expect(terminals[1]!.isVisible).toBe(false)
    expect(terminals[0]!.written).toBe('out-a')
    expect(pty.opens).toHaveLength(2)
  })

  it('5 键入转发 pty.write；实例重排转发 pty.resize', async () => {
    await core.select(a.id)
    terminals[0]!.typeInput('ls\r')
    expect(pty.written).toEqual([[a.id, 'ls\r']])
    terminals[0]!.emitResize({ cols: 120, rows: 40 })
    expect(pty.resizes).toEqual([[a.id, { cols: 120, rows: 40 }]])
  })

  it('6 closeTab：关当前页激活 min(i, len-1) 邻居且其 host 显示；关非当前页 active 不变；全关 activeId 为 null 且全部隐藏；实例与 pty 都保留', async () => {
    await core.select(a.id)
    await core.select(b.id)
    await core.select(c.id)
    await core.select(b.id)

    core.closeTab(b.id)
    expect(core.snapshot()).toMatchObject({ openTabs: [a.id, c.id], activeId: c.id })
    expect(terminals[2]!.isVisible).toBe(true)
    expect(terminals[1]!.isVisible).toBe(false)

    core.closeTab(a.id)
    expect(core.snapshot()).toMatchObject({ openTabs: [c.id], activeId: c.id })
    core.closeTab('ghost')
    expect(core.snapshot().openTabs).toEqual([c.id])

    core.closeTab(c.id)
    expect(core.snapshot()).toMatchObject({ openTabs: [], activeId: null })
    expect(terminals.every((t) => !t.isVisible)).toBe(true)
    expect(terminals.every((t) => !t.isDisposed)).toBe(true)
    expect(pty.opens).toHaveLength(3)
    expect([a, b, c].every((s) => pty.isRunning(s.id))).toBe(true)
    expect(Object.keys(core.snapshot().runtime).sort()).toEqual([a.id, b.id, c.id].sort())
  })

  it('7 pty 退出：实例末尾写提示、phase exited 带 exitCode；之后按键不转发，回车即重启（旧实例销毁、新实例空白、新 spawn、仍是当前页）', async () => {
    await core.select(a.id)
    pty.emitExit(a.id, 3)
    expect(terminals[0]!.written).toContain('[进程已退出，代码 3]')
    expect(core.snapshot().runtime[a.id]).toEqual({ phase: 'exited', exitCode: 3 })

    terminals[0]!.typeInput('x')
    expect(pty.written).toEqual([])
    terminals[0]!.typeInput('\r')
    await flush()
    expect(terminals).toHaveLength(2)
    expect(terminals[0]!.isDisposed).toBe(true)
    expect(terminals[1]!.written).toBe('')
    expect(terminals[1]!.isVisible).toBe(true)
    expect(pty.spawnCount(a.id)).toBe(2)
    expect(core.snapshot()).toEqual({
      openTabs: [a.id],
      activeId: a.id,
      runtime: { [a.id]: { phase: 'running' } },
    })
  })

  it('8 已退出的会话（标签页已关）再次 select → 重启并显示', async () => {
    await core.select(a.id)
    await core.select(b.id)
    pty.emitExit(a.id, 0)
    core.closeTab(a.id)
    expect(core.snapshot().openTabs).toEqual([b.id])

    await core.select(a.id)
    expect(terminals).toHaveLength(3)
    expect(terminals[0]!.isDisposed).toBe(true)
    expect(terminals[2]!.isVisible).toBe(true)
    expect(pty.spawnCount(a.id)).toBe(2)
    expect(core.snapshot()).toEqual({
      openTabs: [b.id, a.id],
      activeId: a.id,
      runtime: { [a.id]: { phase: 'running' }, [b.id]: { phase: 'running' } },
    })
  })

  it('9 syncSessions 缺席 id：销毁实例、移除 host、关标签页（邻居规则）、删运行态；重复 sync 幂等；缺席非当前会话时 active 不变', async () => {
    await core.select(a.id)
    await core.select(b.id)
    await core.select(c.id)
    await core.select(b.id)

    core.syncSessions([a, c])
    expect(terminals[1]!.isDisposed).toBe(true)
    expect(terminals[1]!.host!.parentElement).toBeNull()
    expect(core.snapshot()).toEqual({
      openTabs: [a.id, c.id],
      activeId: c.id,
      runtime: { [a.id]: { phase: 'running' }, [c.id]: { phase: 'running' } },
    })
    expect(terminals[2]!.isVisible).toBe(true)

    const disposedBefore = terminals.filter((t) => t.isDisposed).length
    core.syncSessions([a, c])
    expect(terminals.filter((t) => t.isDisposed)).toHaveLength(disposedBefore)

    core.syncSessions([c])
    expect(core.snapshot()).toMatchObject({ openTabs: [c.id], activeId: c.id })
    expect(terminals[0]!.isDisposed).toBe(true)
    await core.select(b.id)
    expect(core.snapshot().openTabs).toEqual([c.id])
  })

  it('10 打开期间切走：a 的 pty.open 未返回就 select(b)，返回后 a 不抢显示', async () => {
    setup({ manualOpen: true })
    const openA = core.select(a.id)
    const openB = core.select(b.id)
    pty.resolveOpens()
    await openA
    await openB

    expect(terminals[0]!.isVisible).toBe(false)
    expect(terminals[1]!.isVisible).toBe(true)
    expect(core.snapshot()).toEqual({
      openTabs: [a.id, b.id],
      activeId: b.id,
      runtime: { [a.id]: { phase: 'running' }, [b.id]: { phase: 'running' } },
    })
  })

  it('11 pty.open 失败：phase exited（无 exitCode）、console.error 一次、实例仍显示；回车即重试', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    pty.failNextOpen(new Error('spawn 失败'))
    await core.select(a.id)
    expect(core.snapshot().runtime[a.id]).toEqual({ phase: 'exited' })
    expect(error).toHaveBeenCalledTimes(1)
    expect(terminals[0]!.isVisible).toBe(true)

    terminals[0]!.typeInput('\r')
    await flush()
    expect(terminals).toHaveLength(2)
    expect(core.snapshot().runtime[a.id]).toEqual({ phase: 'running' })
    expect(pty.opens).toHaveLength(2)
    error.mockRestore()
  })

  it('12 attach 晚于或早于 select 都把 host 挂进容器；detach 后不再 fit；fitActive / focusActive 只作用于可见实例', async () => {
    core.detach()
    await core.select(a.id)
    expect(terminals[0]!.host!.parentElement).toBeNull()
    core.fitActive()
    expect(terminals[0]!.fitCount).toBe(1)

    const next = document.createElement('div')
    core.attach(next)
    expect(terminals[0]!.host!.parentElement).toBe(next)
    await core.select(b.id)
    expect(terminals[1]!.host!.parentElement).toBe(next)

    const fits = [terminals[0]!.fitCount, terminals[1]!.fitCount]
    core.fitActive()
    core.focusActive()
    expect(terminals[0]!.fitCount).toBe(fits[0])
    expect(terminals[1]!.fitCount).toBe(fits[1]! + 1)
    expect(terminals[0]!.focusCount).toBe(1)
    expect(terminals[1]!.focusCount).toBe(2)
  })

  it('13 subscribe 每次变化收到新快照对象且等于 snapshot()，退订后不再收到；dispose 退订 pty、销毁全部实例、清空记录', async () => {
    const seen: WorkspaceSnapshot[] = []
    const off = core.subscribe((s) => seen.push(s))
    await core.select(a.id)
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen[seen.length - 1]).toEqual(core.snapshot())
    expect(seen[seen.length - 1]).not.toBe(seen[seen.length - 2])
    core.closeTab(a.id)
    expect(seen[seen.length - 1]).toEqual(core.snapshot())

    off()
    const count = seen.length
    await core.select(a.id)
    expect(seen).toHaveLength(count)

    core.dispose()
    expect(pty.subscriberCount).toBe(0)
    expect(terminals.every((t) => t.isDisposed)).toBe(true)
    expect(core.snapshot()).toEqual({ openTabs: [], activeId: null, runtime: {} })
  })
})
