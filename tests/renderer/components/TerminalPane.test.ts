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

  it('终端内搜索框挂在终端区右上角浮层里：Ctrl+Shift+F 打开', async () => {
    const wrapper = mountPane()
    await fake.workspace.select(a.id)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.overlay [data-test=terminal-search]').exists()).toBe(true)
    wrapper.unmount()
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

  describe('拖文字进终端（memo-floating-window 决策 5）', () => {
    /** 拖放事件：happy-dom 没有 DataTransfer，挂一个只有 types / getData / dropEffect 的替身 */
    function drag(
      el: Element,
      type: string,
      data: { types: string[]; text?: string },
    ): { event: Event; transfer: { dropEffect: string } } {
      const event = new Event(type, { bubbles: true, cancelable: true })
      const transfer = {
        types: data.types,
        dropEffect: 'none',
        getData: (t: string) => (t === 'text/plain' ? (data.text ?? '') : ''),
      }
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      el.dispatchEvent(event)
      return { event, transfer }
    }
    const textDrag = (text: string) => ({ types: ['text/plain'], text })

    it('当前终端在运行、拖来的是文字：出现「松开插入到「会话名」」；松手按粘贴送进终端（不加回车）、提示消失、请主进程激活主窗口', async () => {
      const api = installFakeApi()
      const wrapper = mountPane()
      await fake.workspace.select(a.id)
      const wrap = wrapper.find('.term-wrap').element

      drag(wrap, 'dragenter', textDrag(''))
      const over = drag(wrap, 'dragover', textDrag(''))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=terminal-drop]').text()).toBe('松开插入到「a」')
      expect(over.event.defaultPrevented).toBe(true)
      expect(over.transfer.dropEffect).toBe('copy')

      const drop = drag(wrap, 'drop', textDrag('设置「启动」段加勾选框'))
      await wrapper.vm.$nextTick()
      expect(drop.event.defaultPrevented).toBe(true)
      expect(fake.terminals[0]!.pasted).toEqual(['设置「启动」段加勾选框'])
      expect(wrapper.find('[data-test=terminal-drop]').exists()).toBe(false)
      expect(api.app.focusMainWindow).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })

    it('拖着离开终端区：提示消失（经过内部子元素进出不闪）', async () => {
      const wrapper = mountPane()
      await fake.workspace.select(a.id)
      const wrap = wrapper.find('.term-wrap').element
      const pane = wrapper.find('[data-test=terminal-pane]').element

      drag(wrap, 'dragenter', textDrag(''))
      drag(pane, 'dragenter', textDrag(''))
      drag(wrap, 'dragleave', textDrag(''))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=terminal-drop]').exists()).toBe(true)
      drag(pane, 'dragleave', textDrag(''))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=terminal-drop]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('反例：拖来的是文件 / 松手时文字为空 / 终端已退出 —— 不提示（或不收）、不粘贴、不激活窗口', async () => {
      const api = installFakeApi()
      const wrapper = mountPane()
      await fake.workspace.select(a.id)
      const wrap = wrapper.find('.term-wrap').element

      const files = { types: ['Files', 'text/plain'], text: 'notes.txt' }
      drag(wrap, 'dragenter', files)
      expect(drag(wrap, 'dragover', files).event.defaultPrevented).toBe(false)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=terminal-drop]').exists()).toBe(false)
      drag(wrap, 'drop', files)

      drag(wrap, 'dragenter', textDrag(''))
      drag(wrap, 'drop', textDrag('   '))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=terminal-drop]').exists()).toBe(false)

      fake.pty.emitExit(a.id, 0)
      drag(wrap, 'dragenter', textDrag(''))
      expect(drag(wrap, 'dragover', textDrag('')).event.defaultPrevented).toBe(false)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test=terminal-drop]').exists()).toBe(false)
      drag(wrap, 'drop', textDrag('已退出'))

      expect(fake.terminals[0]!.pasted).toEqual([])
      expect(api.app.focusMainWindow).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })
})
