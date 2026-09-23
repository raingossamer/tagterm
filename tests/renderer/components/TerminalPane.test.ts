import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TerminalPane from '../../../src/renderer/src/components/TerminalPane.vue'
import { TERMINAL_WORKSPACE_KEY } from '../../../src/renderer/src/terminal/workspaceKey'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { DEFAULT_BACKGROUND } from '@shared/models'
import { installFakeApi, makeSession, makeSettings } from '../fakeApi'
import { installFakeWorkspace, type FakeWorkspace } from '../fakeWorkspace'

// happy-dom 没有 ResizeObserver；生命周期核心用真核心 + 假端口
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

describe('TerminalPane', () => {
  const a = makeSession({ name: 'a' })
  let fake: FakeWorkspace

  function mountPane() {
    return mount(TerminalPane, {
      global: { provide: { [TERMINAL_WORKSPACE_KEY as symbol]: fake.core } },
    })
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    installFakeApi()
    fake = installFakeWorkspace([a])
    Object.defineProperty(window, 'ResizeObserver', {
      value: FakeResizeObserver,
      configurable: true,
    })
  })

  it('[data-test=terminal-pane] 是终端宿主：选中会话后实例 host 挂在其内，点击空白处聚焦当前终端', async () => {
    const wrapper = mountPane()
    await fake.workspace.select(a.id)
    const pane = wrapper.find('[data-test=terminal-pane]')
    expect(fake.terminals[0]!.host?.parentElement).toBe(pane.element)
    expect(fake.terminals[0]!.isVisible).toBe(true)

    const focusBefore = fake.terminals[0]!.focusCount
    await pane.trigger('click')
    expect(fake.terminals[0]!.focusCount).toBe(focusBefore + 1)
    wrapper.unmount()
  })

  it('终端区不再自己铺背景图（全局背景层负责），底色用面板不透明度派生的变量', async () => {
    const settings = useSettingsStore()
    settings.settings = makeSettings({
      background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/a.png' },
    })
    settings.backgroundImage = 'data:image/png;base64,AAA'
    const wrapper = mountPane()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test=terminal-bg]').exists()).toBe(false)
    expect(wrapper.find('[data-test=terminal-dim]').exists()).toBe(false)
    expect(wrapper.find('[data-test=terminal-pane]').exists()).toBe(true)
  })

  describe('字号小牌', () => {
    afterEach(() => vi.useRealTimers())

    it('Ctrl+滚轮调字号时右上角浮出「字号 N」，停手 1 秒后消失；连续调整从最后一次重新计时', async () => {
      vi.useFakeTimers()
      const wrapper = mountPane()
      await fake.workspace.select(a.id)
      const badge = () => wrapper.find('[data-test=font-size-badge]')
      expect(badge().exists()).toBe(false)

      fake.terminals[0]!.emitFontZoom(1)
      await wrapper.vm.$nextTick()
      expect(badge().text()).toBe('字号 15')

      vi.advanceTimersByTime(800)
      fake.terminals[0]!.emitFontZoom(1)
      await wrapper.vm.$nextTick()
      expect(badge().text()).toBe('字号 16')
      vi.advanceTimersByTime(800)
      await wrapper.vm.$nextTick()
      expect(badge().exists()).toBe(true)

      vi.advanceTimersByTime(200)
      await wrapper.vm.$nextTick()
      expect(badge().exists()).toBe(false)
      wrapper.unmount()
    })

    it('到上下限再滚也浮出小牌（显示的就是上限值），让人知道到头了；挂载时（启动恢复字号）不弹', async () => {
      vi.useFakeTimers()
      fake.core.setFontSize(32)
      const wrapper = mountPane()
      await fake.workspace.select(a.id)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=font-size-badge]').exists()).toBe(false)

      fake.terminals[0]!.emitFontZoom(1)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=font-size-badge]').text()).toBe('字号 32')
      wrapper.unmount()
    })
  })
})
