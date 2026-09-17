import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutputReport } from '@shared/ipc'
import { OutputWatcher } from '../../src/renderer/src/terminal/OutputWatcher'

describe('OutputWatcher（每会话静默 1.5 s 后读屏幕末尾上报）', () => {
  let tails: Record<string, string[] | null>
  let reports: Array<[string, OutputReport]>
  let watcher: OutputWatcher

  beforeEach(() => {
    vi.useFakeTimers()
    tails = { a: ['C:/x>'], b: ['Allow?'] }
    reports = []
    watcher = new OutputWatcher({
      readTail: (id, n) => tails[id]?.slice(-n) ?? null,
      report: (id, r) => reports.push([id, r]),
      silenceMs: 1500,
      tailLines: 8,
    })
  })
  afterEach(() => {
    watcher.dispose()
    vi.useRealTimers()
  })

  it('数据到达后静默 1.5 s 才上报一次；期间再来数据重新计时；两个会话各自独立', () => {
    watcher.touch('a')
    vi.advanceTimersByTime(1000)
    expect(reports).toEqual([])
    watcher.touch('a') // 重置
    vi.advanceTimersByTime(1000)
    expect(reports).toEqual([])
    vi.advanceTimersByTime(500)
    expect(reports).toEqual([['a', { tail: ['C:/x>'], silentMs: 1500 }]])

    // 静默之后没有新数据就不再上报
    vi.advanceTimersByTime(5000)
    expect(reports).toHaveLength(1)

    watcher.touch('a')
    watcher.touch('b')
    vi.advanceTimersByTime(1500)
    expect(reports.slice(1)).toEqual([
      ['a', { tail: ['C:/x>'], silentMs: 1500 }],
      ['b', { tail: ['Allow?'], silentMs: 1500 }],
    ])
  })

  it('读不到末尾（实例已没了）不上报；forget 取消计时；dispose 取消全部', () => {
    watcher.touch('ghost')
    vi.advanceTimersByTime(1500)
    expect(reports).toEqual([])

    watcher.touch('a')
    watcher.forget('a')
    vi.advanceTimersByTime(1500)
    expect(reports).toEqual([])

    watcher.touch('a')
    watcher.touch('b')
    watcher.dispose()
    vi.advanceTimersByTime(1500)
    expect(reports).toEqual([])
  })

  it('readTail 只取 tailLines 行', () => {
    tails['a'] = Array.from({ length: 20 }, (_, i) => `l${i}`)
    watcher.touch('a')
    vi.advanceTimersByTime(1500)
    expect(reports[0]![1].tail).toHaveLength(8)
    expect(reports[0]![1].tail[7]).toBe('l19')
  })
})
