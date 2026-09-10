import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TerminalPane from '../../../src/renderer/src/components/TerminalPane.vue'
import { TERMINAL_POOL_KEY } from '../../../src/renderer/src/terminal/poolKey'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { installFakeApi, makeSettings } from '../fakeApi'

// happy-dom 没有 ResizeObserver；实例池以假对象注入
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
const fakePool = { attach: vi.fn(), detach: vi.fn(), fitActive: vi.fn(), focusActive: vi.fn() }

function mountPane() {
  return mount(TerminalPane, { global: { provide: { [TERMINAL_POOL_KEY as symbol]: fakePool } } })
}

describe('TerminalPane', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    installFakeApi()
    Object.defineProperty(window, 'ResizeObserver', {
      value: FakeResizeObserver,
      configurable: true,
    })
  })

  it('无背景图时只有纯色容器；实例池容器仍是 [data-test=terminal-pane]', () => {
    const wrapper = mountPane()
    expect(wrapper.find('[data-test=terminal-bg]').exists()).toBe(false)
    expect(fakePool.attach).toHaveBeenCalledWith(wrapper.find('[data-test=terminal-pane]').element)
  })

  it('有背景图时铺满 data: URL 图片并盖上按 dimOpacity 的黑色遮罩', async () => {
    const settings = useSettingsStore()
    settings.settings = makeSettings({
      terminalBackground: { imagePath: 'D:/a.png', dimOpacity: 0.35 },
    })
    settings.backgroundImage = 'data:image/png;base64,AAA'
    const wrapper = mountPane()

    const bg = wrapper.find('[data-test=terminal-bg]')
    expect(bg.attributes('style')).toContain('data:image/png;base64,AAA')
    expect(wrapper.find('[data-test=terminal-dim]').attributes('style')).toContain('0.35')

    settings.backgroundImage = null
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test=terminal-bg]').exists()).toBe(false)
  })
})
