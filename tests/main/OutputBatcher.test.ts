import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from '../../src/main/pty/OutputBatcher'

describe('OutputBatcher（pty 输出合并）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('16 ms 内的多个块合并成一次回调', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('a')
    batcher.push('b')
    batcher.push('c')
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(16)
    expect(flushed).toEqual(['abc'])
  })

  it('累计超过 64 KB 立即 flush，不等定时器', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('x'.repeat(60 * 1024))
    batcher.push('y'.repeat(5 * 1024))
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toHaveLength(65 * 1024)
  })

  it('flush() 立即送出剩余内容；dispose() 后丢弃未送出内容且不再回调', () => {
    const flushed: string[] = []
    const batcher = new OutputBatcher((data) => flushed.push(data))

    batcher.push('tail')
    batcher.flush()
    expect(flushed).toEqual(['tail'])

    batcher.push('dropped')
    batcher.dispose()
    vi.advanceTimersByTime(50)
    expect(flushed).toEqual(['tail'])
  })
})
