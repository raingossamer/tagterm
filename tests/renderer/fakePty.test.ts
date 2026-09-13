import { describe, expect, it } from 'vitest'
import { FakePty } from './fakePty'

describe('FakePty（剧本式假 pty，语义与主进程 PtyManager 一致）', () => {
  it('open 后会话在运行且重复 open 复用；exit 即删条目；再次 open 是新 spawn（created 为 true，spawnCount 为 2）', async () => {
    const pty = new FakePty()
    const first = await pty.open('s1', { cols: 80, rows: 24 })
    expect(first.created).toBe(true)
    expect(pty.isRunning('s1')).toBe(true)
    const again = await pty.open('s1', { cols: 80, rows: 24 })
    expect(again).toEqual({ created: false, pid: first.pid })
    expect(pty.spawnCount('s1')).toBe(1)

    pty.emitExit('s1', 3)
    expect(pty.isRunning('s1')).toBe(false)
    const reopened = await pty.open('s1', { cols: 100, rows: 30 })
    expect(reopened.created).toBe(true)
    expect(reopened.pid).not.toBe(first.pid)
    expect(pty.spawnCount('s1')).toBe(2)
    expect(pty.opens.map((o) => [o.sessionId, o.size.cols, o.created])).toEqual([
      ['s1', 80, true],
      ['s1', 80, false],
      ['s1', 100, true],
    ])
  })

  it('manualOpen：open 挂起不 resolve，resolveOpens 后按顺序全部 resolve', async () => {
    const pty = new FakePty({ manualOpen: true })
    const settled: string[] = []
    void pty.open('a', { cols: 80, rows: 24 }).then(() => settled.push('a'))
    void pty.open('b', { cols: 80, rows: 24 }).then(() => settled.push('b'))
    await Promise.resolve()
    expect(settled).toEqual([])
    expect(pty.isRunning('a')).toBe(true) // 条目在 open 调用时就登记，与主进程 spawn 即登记一致

    pty.resolveOpens()
    await Promise.resolve()
    expect(settled).toEqual(['a', 'b'])
  })

  it('onData / onExit 只送到仍在订阅的回调；write / resize 被记录', async () => {
    const pty = new FakePty()
    const data: string[] = []
    const exits: number[] = []
    const offData = pty.onData((id, d) => data.push(`${id}:${d}`))
    pty.onExit((e) => exits.push(e.exitCode))

    pty.emitData('s1', 'hi')
    offData()
    pty.emitData('s1', 'late')
    pty.emitExit('s1', 7)
    expect(data).toEqual(['s1:hi'])
    expect(exits).toEqual([7])
    expect(pty.subscriberCount).toBe(1)

    pty.write('s1', 'ls\r')
    await pty.resize('s1', { cols: 120, rows: 40 })
    expect(pty.written).toEqual([['s1', 'ls\r']])
    expect(pty.resizes).toEqual([['s1', { cols: 120, rows: 40 }]])
  })
})
