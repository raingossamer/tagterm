import { beforeEach, describe, expect, it } from 'vitest'
import { TerminalPool } from '../../src/renderer/src/terminal/TerminalPool'
import type {
  FontZoom,
  SearchResult,
  TerminalSize,
} from '../../src/renderer/src/terminal/TerminalInstance'
import { FakeTerminal } from './fakeTerminal'

describe('TerminalPool（只管 xterm 一侧，不认识 pty）', () => {
  let terminals: FakeTerminal[]
  let container: HTMLElement
  let inputs: Array<[string, string]>
  let resizes: Array<[string, TerminalSize]>
  let zooms: FontZoom[]
  let results: Array<[string, SearchResult]>
  let nextSize: TerminalSize | null
  let pool: TerminalPool

  beforeEach(() => {
    terminals = []
    inputs = []
    resizes = []
    zooms = []
    results = []
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
      onFontZoom: (zoom) => zooms.push(zoom),
      onSearchResults: (id, result) => results.push([id, result]),
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

  it('setWebglAllowed(false)（设了全局背景图：WebGL 会给暗淡字垫不透明黑底）→ 可见实例立即退回 DOM 渲染，之后 show 也不再开 WebGL；恢复允许 → 只有可见实例重新开', () => {
    pool.open('a')
    pool.open('b')
    pool.show('a')
    expect(terminals[0]!.isWebgl).toBe(true)

    pool.setWebglAllowed(false)
    expect(terminals[0]!.isWebgl).toBe(false)
    pool.show('b')
    expect(terminals[1]!.isWebgl).toBe(false)
    expect(terminals[0]!.isWebgl).toBe(false)

    pool.setWebglAllowed(true)
    expect(terminals[1]!.isWebgl).toBe(true)
    expect(terminals[0]!.isWebgl).toBe(false)
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

  it('readTail 转发到对应实例（自底向上取非空行）；未知会话为 null', () => {
    pool.open('a')
    pool.write('a', 'line1\r\nline2\r\n\r\nline3\r\n')
    expect(pool.readTail('a', 2)).toEqual(['line2', 'line3'])
    expect(pool.readTail('a', 10)).toEqual(['line1', 'line2', 'line3'])
    expect(pool.readTail('ghost', 2)).toBeNull()
  })

  it('setFontSize：全部实例一起换字号，只 fit 可见实例（隐藏的切过去时 show 会 fit）；之后新建的实例首次 fit 前就用当前字号；同值不动', () => {
    pool.open('a')
    pool.open('b')
    pool.show('a')
    const fitsBefore = [terminals[0]!.fitCount, terminals[1]!.fitCount]

    pool.setFontSize(18)
    expect(terminals.map((t) => t.fontSize)).toEqual([18, 18])
    expect(terminals[0]!.fitCount).toBe(fitsBefore[0]! + 1)
    expect(terminals[1]!.fitCount).toBe(fitsBefore[1])

    pool.setFontSize(18)
    expect(terminals[0]!.fitCount).toBe(fitsBefore[0]! + 1)

    // 新实例：open 里先设字号再量尺寸
    const sizesAtFit: number[] = []
    const origFit = FakeTerminal.prototype.fit
    FakeTerminal.prototype.fit = function (this: FakeTerminal) {
      sizesAtFit.push(this.fontSize)
      return origFit.call(this)
    }
    try {
      pool.open('c')
    } finally {
      FakeTerminal.prototype.fit = origFit
    }
    expect(terminals[2]!.fontSize).toBe(18)
    expect(sizesAtFit).toEqual([18])
  })

  it('任一实例上的 Ctrl+滚轮 / Ctrl+0 经 onFontZoom 交上层（池不自己改字号）', () => {
    pool.open('a')
    pool.open('b')
    terminals[1]!.emitFontZoom(2)
    terminals[0]!.emitFontZoom('reset')
    expect(zooms).toEqual([2, 'reset'])
    expect(terminals.map((t) => t.fontSize)).toEqual([14, 14])

    pool.dispose('b')
    terminals[1]!.emitFontZoom(1)
    expect(zooms).toEqual([2, 'reset'])
  })

  it('查找只作用于可见实例：findNext / findPrevious 查当前终端，结果带会话 id 经 onSearchResults 上报；clearSearch 清指定实例；没有可见实例时无副作用', () => {
    pool.open('a')
    pool.open('b')
    pool.write('a', 'error one\r\nERROR two\r\n')
    pool.write('b', 'error in b\r\n')
    pool.find('error', 'next')
    expect(results).toEqual([])

    pool.show('a')
    pool.find('error', 'next')
    pool.find('error', 'next')
    pool.find('error', 'previous')
    expect(results).toEqual([
      ['a', { index: 0, count: 2 }],
      ['a', { index: 1, count: 2 }],
      ['a', { index: 0, count: 2 }],
    ])
    expect(terminals[1]!.searchQuery).toBe('')

    pool.find('err', 'next', { incremental: true })
    expect(terminals[0]!.searchQuery).toBe('err')

    pool.clearSearch('a')
    expect(terminals[0]!.clearSearchCount).toBe(1)
    pool.clearSearch('ghost')
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
