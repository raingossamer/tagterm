import { beforeEach, describe, expect, it } from 'vitest'
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
})
