import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { NOW_TICK_MS, useNow } from '../../src/renderer/src/composables/useNow'

// 备忘小窗一开可能好几天：「现在」每分钟走一次、窗口拿到焦点时立即刷新，卸载后不再走
describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 15, 23, 59))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function host(): { now: () => Date; unmount: () => void } {
    let read: () => Date = () => new Date(0)
    const w = mount(
      defineComponent({
        setup() {
          const now = useNow()
          read = () => now.value
          return () => h('div')
        },
      }),
    )
    return { now: () => read(), unmount: () => w.unmount() }
  }

  it('每分钟走一次；窗口拿到焦点时立即刷新；卸载后不再走', () => {
    const c = host()
    expect(c.now().getDate()).toBe(15)

    vi.setSystemTime(new Date(2026, 10, 16, 0, 0, 30))
    expect(c.now().getDate()).toBe(15)
    vi.advanceTimersByTime(NOW_TICK_MS)
    expect(c.now().getDate()).toBe(16)

    vi.setSystemTime(new Date(2026, 10, 17, 9))
    window.dispatchEvent(new Event('focus'))
    expect(c.now().getDate()).toBe(17)

    c.unmount()
    vi.setSystemTime(new Date(2026, 10, 18, 9))
    vi.advanceTimersByTime(NOW_TICK_MS)
    window.dispatchEvent(new Event('focus'))
    expect(c.now().getDate()).toBe(17)
  })
})
