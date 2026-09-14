import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebounced } from '../../src/renderer/src/composables/debounce'

describe('createDebounced', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('连续调用只在安静 waitMs 后执行一次（拖动窗口时的逐帧 resize 合并成一次 fit）', () => {
    const fn = vi.fn()
    const d = createDebounced(fn, 80)

    d.call()
    d.call()
    vi.advanceTimersByTime(79)
    expect(fn).not.toHaveBeenCalled()

    d.call() // 又一帧：重新计时
    vi.advanceTimersByTime(79)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('安静之后再调用会再执行一次；cancel 取消尚未执行的那次', () => {
    const fn = vi.fn()
    const d = createDebounced(fn, 50)

    d.call()
    vi.advanceTimersByTime(50)
    d.call()
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2)

    d.call()
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
