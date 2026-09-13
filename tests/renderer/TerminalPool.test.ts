import { beforeEach, describe, expect, it } from 'vitest'
import { TerminalPool } from '../../src/renderer/src/terminal/TerminalPool'
import type { TerminalSize } from '../../src/renderer/src/terminal/TerminalInstance'
import { FakeTerminal } from './fakeTerminal'

describe('TerminalPool（只管 xterm 一侧，不认识 pty）', () => {
  let terminals: FakeTerminal[]
  let container: HTMLElement
  let inputs: Array<[string, string]>
  let resizes: Array<[string, TerminalSize]>
  let nextSize: TerminalSize | null
  let pool: TerminalPool

  beforeEach(() => {
    terminals = []
    inputs = []
    resizes = []
    nextSize = { cols: 80, rows: 24 }
    container = document.createElement('div')
    pool = new TerminalPool({
      createTerminal: () => {
        const t = new FakeTerminal()
        t.size = nextSize
        terminals.push(t)
        return t
      },
      raf: (fn) => fn(),
      onInput: (id, data) => inputs.push([id, data]),
      onResize: (id, size) => resizes.push([id, size]),
    })
    pool.attach(container)
  })

  it('open 同步建实例并挂到容器内的 host（初始隐藏），返回 fit 尺寸；重复 open 幂等且返回同尺寸', () => {
    expect(pool.open('a')).toEqual({ cols: 80, rows: 24 })
    expect(pool.open('a')).toEqual({ cols: 80, rows: 24 })

    expect(terminals).toHaveLength(1)
    expect(terminals[0]!.host?.parentElement).toBe(container)
    expect(terminals[0]!.isVisible).toBe(false)
    expect(terminals[0]!.fitCount).toBe(1)
    expect(pool.has('a')).toBe(true)
    expect(pool.sessionIds()).toEqual(['a'])
  })

  it('宿主量不到尺寸（fit 返回 null）时回退 80×24', () => {
    nextSize = null
    expect(pool.open('a')).toEqual({ cols: 80, rows: 24 })
  })

  it('write 按 sessionId 写入对应实例、未知 id 忽略；键入经 onInput、重排经 onResize 交上层裁决', () => {
    pool.open('a')
    pool.open('b')

    pool.write('b', 'hello-b')
    pool.write('ghost', 'x')
    expect(terminals[1]!.written).toBe('hello-b')
    expect(terminals[0]!.written).toBe('')

    terminals[0]!.typeInput('ls\r')
    expect(inputs).toEqual([['a', 'ls\r']])
    terminals[0]!.emitResize({ cols: 120, rows: 40 })
    expect(resizes).toEqual([['a', { cols: 120, rows: 40 }]])
  })

  it('show 只显示目标实例并在下一帧 fit + focus，WebGL 只挂在可见实例；fitActive / focusActive 只作用于可见实例；hide 隐藏全部', () => {
    pool.open('a')
    pool.open('b')

    pool.show('a')
    expect(terminals[0]!.isVisible).toBe(true)
    expect(terminals[1]!.isVisible).toBe(false)
    expect(terminals[0]!.focusCount).toBe(1)
    expect(terminals[0]!.fitCount).toBe(2)
    expect(terminals[0]!.isWebgl).toBe(true)
    expect(terminals[1]!.isWebgl).toBe(false)

    pool.show('b')
    expect(terminals[0]!.isVisible).toBe(false)
    expect(terminals[1]!.isVisible).toBe(true)
    expect(terminals[0]!.isWebgl).toBe(false)
    expect(terminals[1]!.isWebgl).toBe(true)

    const fitsBefore = [terminals[0]!.fitCount, terminals[1]!.fitCount]
    pool.fitActive()
    pool.focusActive()
    expect(terminals[0]!.fitCount).toBe(fitsBefore[0])
    expect(terminals[1]!.fitCount).toBe(fitsBefore[1]! + 1)
    expect(terminals[0]!.focusCount).toBe(1)
    expect(terminals[1]!.focusCount).toBe(2)

    pool.hide()
    expect(terminals[0]!.isVisible).toBe(false)
    expect(terminals[1]!.isVisible).toBe(false)
    pool.fitActive()
    pool.focusActive()
    expect(terminals[1]!.fitCount).toBe(fitsBefore[1]! + 1)
    expect(terminals[1]!.focusCount).toBe(2)
  })

  it('dispose 销毁实例、移除 host，之后 write 无效；再 open 同一会话新建实例', () => {
    pool.open('a')
    pool.open('b')
    pool.show('a')

    pool.dispose('a')
    expect(terminals[0]!.isDisposed).toBe(true)
    expect(terminals[0]!.host!.parentElement).toBeNull()
    expect(pool.has('a')).toBe(false)
    pool.write('a', 'late')
    expect(terminals[0]!.written).toBe('')
    pool.focusActive()
    expect(terminals[1]!.focusCount).toBe(0)

    pool.open('a')
    expect(terminals).toHaveLength(3)
    expect(terminals[2]!.host?.parentElement).toBe(container)
  })

  it('attach 补挂已建的 host；detach 后再 attach 到新容器同样补挂', () => {
    pool.detach()
    pool.open('a')
    expect(terminals[0]!.host!.parentElement).toBeNull()

    const next = document.createElement('div')
    pool.attach(next)
    expect(terminals[0]!.host!.parentElement).toBe(next)
    pool.open('b')
    expect(terminals[1]!.host!.parentElement).toBe(next)
  })
})
