import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutputReport } from '@shared/ipc'
import { OutputWatcher } from '../../src/renderer/src/terminal/OutputWatcher'

describe('OutputWatcher（每会话：屏幕在动时每 1 s 补报一次，静默 1.5 s 后再报一次）', () => {
  let tails: Record<string, string[] | null>
  let reports: Array<[string, OutputReport]>
  let watcher: OutputWatcher
  /** 只看静默报告 */
  const silentReports = (): Array<[string, OutputReport]> =>
    reports.filter(([, r]) => r.silentMs > 0)

  beforeEach(() => {
    vi.useFakeTimers()
    tails = { a: ['C:/x>'], b: ['Allow?'] }
    reports = []
    watcher = new OutputWatcher({
      readTail: (id, n) => tails[id]?.slice(-n) ?? null,
      report: (id, r) => reports.push([id, r]),
      silenceMs: 1500,
      activeMs: 1000,
      tailLines: 24,
    })
  })
  afterEach(() => {
    watcher.dispose()
    vi.useRealTimers()
  })

  it('静默报告：数据到达后静默 1.5 s 才报一次（silentMs 1500）；期间再来数据重新计时；两个会话各自独立', () => {
    watcher.touch('a')
    vi.advanceTimersByTime(1000)
    expect(silentReports()).toEqual([])
    watcher.touch('a') // 重置
    vi.advanceTimersByTime(1000)
    expect(silentReports()).toEqual([])
    vi.advanceTimersByTime(500)
    expect(silentReports()).toEqual([['a', { tail: ['C:/x>'], silentMs: 1500 }]])

    // 静默之后没有新数据就不再上报（两种都不再有）
    const count = reports.length
    vi.advanceTimersByTime(5000)
    expect(reports).toHaveLength(count)

    watcher.touch('a')
    watcher.touch('b')
    vi.advanceTimersByTime(1500)
    expect(silentReports().slice(1)).toEqual([
      ['a', { tail: ['C:/x>'], silentMs: 1500 }],
      ['b', { tail: ['Allow?'], silentMs: 1500 }],
    ])
  })

  it('屏幕在动的补报：数据到达 1 s 后报一次 silentMs 0；持续到达时每 1 s 一次、静默报告一次都没有；停下后 1.5 s 才有静默报告', () => {
    watcher.touch('a')
    vi.advanceTimersByTime(999)
    expect(reports).toEqual([])
    vi.advanceTimersByTime(1)
    expect(reports).toEqual([['a', { tail: ['C:/x>'], silentMs: 0 }]])

    // 从 1000 ms 起每 300 ms 来一次数据，直到 4000 ms：补报在 2000 / 3200 ms（各由上一次补报之后的第一次数据起算）
    for (let i = 0; i < 10; i += 1) {
      watcher.touch('a')
      vi.advanceTimersByTime(300)
    }
    expect(reports).toHaveLength(3)
    expect(reports.every(([, r]) => r.silentMs === 0)).toBe(true)
    // 最后一次数据在 3700 ms：4400 ms 补报、5200 ms 静默报告，之后没有了
    vi.advanceTimersByTime(400)
    expect(reports).toHaveLength(4)
    expect(reports[3]![1].silentMs).toBe(0)
    vi.advanceTimersByTime(800)
    expect(reports).toHaveLength(5)
    expect(reports[4]).toEqual(['a', { tail: ['C:/x>'], silentMs: 1500 }])
    vi.advanceTimersByTime(5000)
    expect(reports).toHaveLength(5)
  })

  it('读不到末尾（实例已没了）不上报；forget 取消两种计时；dispose 取消全部', () => {
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
    tails['a'] = Array.from({ length: 30 }, (_, i) => `l${i}`)
    watcher.touch('a')
    vi.advanceTimersByTime(1500)
    expect(reports.at(-1)![1].tail).toHaveLength(24)
    expect(reports.at(-1)![1].tail[23]).toBe('l29')
  })
})
