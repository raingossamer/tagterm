import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyExitEvent } from '@shared/ipc'
import { TerminalPool } from '../../src/renderer/src/terminal/TerminalPool'
import { createFakeApi, makeSession } from './fakeApi'
import { FakeTerminal } from './fakeTerminal'

describe('TerminalPool', () => {
  const a = makeSession({ name: 'a' })
  const b = makeSession({ name: 'b' })
  let terminals: FakeTerminal[]
  let container: HTMLElement
  let dataCb: ((sessionId: string, data: string) => void) | undefined
  let exitCb: ((e: PtyExitEvent) => void) | undefined
  let api: ReturnType<typeof createFakeApi>
  let pool: TerminalPool

  beforeEach(() => {
    terminals = []
    dataCb = undefined
    exitCb = undefined
    api = createFakeApi({
      pty: {
        onData: vi.fn((cb) => {
          dataCb = cb
          return () => {
            dataCb = undefined
          }
        }),
        onExit: vi.fn((cb) => {
          exitCb = cb
          return () => {
            exitCb = undefined
          }
        }),
      },
    })
    container = document.createElement('div')
    pool = new TerminalPool({
      pty: api.pty,
      createTerminal: () => {
        const t = new FakeTerminal()
        terminals.push(t)
        return t
      },
      raf: (fn) => fn(),
    })
    pool.attach(container)
  })

  it('open 建实例并挂到容器内的 host，按 fit 结果打开 pty；重复 open 幂等', async () => {
    await pool.open(a)
    await pool.open(a)

    expect(terminals).toHaveLength(1)
    expect(terminals[0]!.host?.parentElement).toBe(container)
    expect(api.pty.open).toHaveBeenCalledTimes(1)
    expect(api.pty.open).toHaveBeenCalledWith(a.id, { cols: 80, rows: 24 })
    expect(pool.has(a.id)).toBe(true)
  })

  it('pty:data 按 sessionId 路由到对应实例；键入转发到 pty.write；onResize 转发到 pty.resize', async () => {
    await pool.open(a)
    await pool.open(b)

    dataCb!(b.id, 'hello-b')
    expect(terminals[1]!.written).toBe('hello-b')
    expect(terminals[0]!.written).toBe('')

    terminals[0]!.typeInput('ls\r')
    expect(api.pty.write).toHaveBeenCalledWith(a.id, 'ls\r')

    terminals[0]!.emitResize({ cols: 120, rows: 40 })
    expect(api.pty.resize).toHaveBeenCalledWith(a.id, { cols: 120, rows: 40 })
  })

  it('show 只显示目标实例并 fit + focus，WebGL 只挂在可见实例；fitActive 只 fit 可见实例', async () => {
    await pool.open(a)
    await pool.open(b)

    pool.show(a.id)
    expect(terminals[0]!.host!.style.display).toBe('block')
    expect(terminals[1]!.host!.style.display).toBe('none')
    expect(terminals[0]!.focusCount).toBe(1)
    expect(terminals[0]!.isWebgl).toBe(true)
    expect(terminals[1]!.isWebgl).toBe(false)

    pool.show(b.id)
    expect(terminals[0]!.host!.style.display).toBe('none')
    expect(terminals[1]!.host!.style.display).toBe('block')
    expect(terminals[0]!.isWebgl).toBe(false)
    expect(terminals[1]!.isWebgl).toBe(true)

    const fitsBefore = [terminals[0]!.fitCount, terminals[1]!.fitCount]
    pool.fitActive()
    expect(terminals[0]!.fitCount).toBe(fitsBefore[0])
    expect(terminals[1]!.fitCount).toBe(fitsBefore[1]! + 1)

    pool.hide()
    expect(terminals[1]!.host!.style.display).toBe('none')
  })

  it('pty:exit 在对应实例末尾写入退出提示并回调 onExit；退出后按回车请求重启、按键不再转发', async () => {
    const exits: PtyExitEvent[] = []
    const restarts: string[] = []
    pool = new TerminalPool({
      pty: api.pty,
      createTerminal: () => {
        const t = new FakeTerminal()
        terminals.push(t)
        return t
      },
      raf: (fn) => fn(),
      onExit: (e) => exits.push(e),
      onRestartRequested: (id) => restarts.push(id),
    })
    pool.attach(container)
    await pool.open(a)

    exitCb!({ sessionId: a.id, exitCode: 3 })
    expect(terminals[0]!.written).toContain('[进程已退出，代码 3]')
    expect(exits).toEqual([{ sessionId: a.id, exitCode: 3 }])

    terminals[0]!.typeInput('x')
    expect(restarts).toEqual([])
    terminals[0]!.typeInput('\r')
    expect(restarts).toEqual([a.id])
    expect(api.pty.write).not.toHaveBeenCalled()
  })

  it('dispose 后重新 open 同一会话会新建实例并重新打开 pty（重启 shell）', async () => {
    await pool.open(a)
    pool.dispose(a.id)
    await pool.open(a)

    expect(terminals).toHaveLength(2)
    expect(api.pty.open).toHaveBeenCalledTimes(2)
  })

  it('dispose 销毁实例、移除 host、不再接收该会话的数据', async () => {
    await pool.open(a)
    await pool.open(b)

    pool.dispose(a.id)
    expect(terminals[0]!.isDisposed).toBe(true)
    expect(terminals[0]!.host!.parentElement).toBeNull()
    expect(pool.has(a.id)).toBe(false)

    dataCb!(a.id, 'late')
    expect(terminals[0]!.written).toBe('')
    dataCb!(b.id, 'ok')
    expect(terminals[1]!.written).toBe('ok')
  })

  it('detach 取消全局订阅', () => {
    pool.detach()
    expect(dataCb).toBeUndefined()
    expect(exitCb).toBeUndefined()
  })
})
