import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from '../../src/main/pty/OutputBatcher'

describe('OutputBatcher（pty 输出合并）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('第一块立即回调，不等 16 ms（按键回显不多等一拍）', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('a')
    expect(flushed).toEqual(['a'])
  })

  it('首块之后 16 ms 窗口内到达的块合并，窗口结束一次发出', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('a')
    batcher.push('b')
    batcher.push('c')
    expect(flushed).toEqual(['a'])

    vi.advanceTimersByTime(15)
    expect(flushed).toEqual(['a'])
    vi.advanceTimersByTime(1)
    expect(flushed).toEqual(['a', 'bc'])
  })

  it('连续输出：窗口结束时发出并再开一个窗口，之后到达的块仍每 16 ms 一批', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('a')
    batcher.push('b')
    vi.advanceTimersByTime(16)
    expect(flushed).toEqual(['a', 'b'])

    batcher.push('c') // 紧接着到达：还在新窗口里，不立即发
    batcher.push('d')
    expect(flushed).toEqual(['a', 'b'])
    vi.advanceTimersByTime(16)
    expect(flushed).toEqual(['a', 'b', 'cd'])
  })

  it('窗口结束时没有内容则关闭窗口，下一块又立即发', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('a')
    vi.advanceTimersByTime(16)
    batcher.push('b')
    expect(flushed).toEqual(['a', 'b'])
  })

  it('窗口内累计超过 64 KB 立即 flush，不等窗口结束', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('a')
    batcher.push('x'.repeat(60 * 1024))
    expect(flushed).toEqual(['a'])
    batcher.push('y'.repeat(5 * 1024))
    expect(flushed).toHaveLength(2)
    expect(flushed[1]).toHaveLength(65 * 1024)
  })

  it('flush() 立即送出窗口内的剩余内容；dispose() 后丢弃未送出内容且不再回调', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('head')
    batcher.push('tail')
    batcher.flush()
    expect(flushed).toEqual(['head', 'tail'])

    batcher.push('dropped')
    batcher.dispose()
    vi.advanceTimersByTime(50)
    expect(flushed).toEqual(['head', 'tail'])
  })
})
