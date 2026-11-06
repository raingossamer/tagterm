import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TabBar from '../../../src/renderer/src/components/TabBar.vue'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useAgentStore } from '../../../src/renderer/src/stores/agent'
import { installFakeApi, makeSession } from '../fakeApi'
import { installFakeWorkspace, type FakeWorkspace } from '../fakeWorkspace'

describe('TabBar', () => {
  const a = makeSession({ name: 'simba-api' })
  const b = makeSession({ name: 'iot' })
  let fake: FakeWorkspace

  beforeEach(async () => {
    setActivePinia(createPinia())
    installFakeApi()
    fake = installFakeWorkspace([a, b])
    await fake.workspace.select(a.id)
    await fake.workspace.select(b.id)
    await fake.workspace.select(a.id)
  })

  it('为每个打开的标签页渲染名称与状态点，当前页高亮；点击 / Enter 发出 select', async () => {
    const wrapper = mount(TabBar)
    const tabs = wrapper.findAll('[data-test=tab]')

    expect(tabs.map((t) => t.find('[data-test=tab-name]').text())).toEqual(['simba-api', 'iot'])
    expect(tabs[0]!.classes()).toContain('active')
    expect(tabs[1]!.classes()).not.toContain('active')
    expect(tabs[0]!.find('.dot').exists()).toBe(true)

    await tabs[1]!.trigger('click')
    await tabs[0]!.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([[b.id], [a.id]])
  })

  it('× 只关闭标签页（会话继续在后台保持）：pty 仍在、实例未销毁，active 切到邻居', async () => {
    const wrapper = mount(TabBar)

    await wrapper.findAll('[data-test=tab-close]')[0]!.trigger('click')

    const ws = useWorkspaceStore()
    expect(ws.openTabs).toEqual([b.id])
    expect(ws.activeId).toBe(b.id)
    expect(fake.pty.isRunning(a.id)).toBe(true)
    expect(fake.terminals.every((t) => !t.isDisposed)).toBe(true)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('☰ 切换侧栏收起；＋ 发出 newSession', async () => {
    const wrapper = mount(TabBar)

    await wrapper.find('[data-test=tab-side]').trigger('click')
    expect(useWorkspaceStore().sideHidden).toBe(true)

    await wrapper.find('[data-test=tab-add]').trigger('click')
    expect(wrapper.emitted('newSession')).toHaveLength(1)
  })

  it('标签页的状态点取 agent store：无记录为 idle，有记录按状态加类名；tooltip 恒为完整会话名，等你确认时再加一行「等你确认：<提示>」', async () => {
    const agent = useAgentStore()
    agent.runtime = {
      [b.id]: {
        sessionId: b.id,
        alive: true,
        agent: 'claude',
        status: 'blocked',
        pendingHint: 'Allow?',
      },
    }
    const wrapper = mount(TabBar)
    const tabs = wrapper.findAll('[data-test=tab]')
    const dots = wrapper.findAll('[data-test=tab] .dot')

    expect(dots[0]!.classes()).toContain('idle')
    expect(dots[1]!.classes()).toContain('blocked')
    expect(tabs[0]!.attributes('title')).toBe('simba-api')
    expect(tabs[1]!.attributes('title')).toBe('iot\n等你确认：Allow?')
  })

  describe('标签页一多：定位与滚动', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('☰ 与 ＋ 钉在两端，只有中间的标签页区滚动', () => {
      const wrapper = mount(TabBar)
      const scroller = wrapper.find('[data-test=tab-scroller]')

      expect(scroller.findAll('[data-test=tab]')).toHaveLength(2)
      expect(scroller.find('[data-test=tab-side]').exists()).toBe(false)
      expect(scroller.find('[data-test=tab-add]').exists()).toBe(false)
      expect(wrapper.find('[data-test=tab-side]').exists()).toBe(true)
      expect(wrapper.find('[data-test=tab-add]').exists()).toBe(true)
    })

    it('当前页变化时把它滚进视野（只滚最近的那一侧，不动整页）', async () => {
      const calls: { name: string; options: unknown }[] = []
      vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
        this: HTMLElement,
        options?: boolean | ScrollIntoViewOptions,
      ) {
        calls.push({ name: this.querySelector('[data-test=tab-name]')?.textContent ?? '', options })
      })
      mount(TabBar, { attachTo: document.body })
      await nextTick()
      calls.length = 0

      await useWorkspaceStore().select(b.id)
      await nextTick()

      expect(calls).toEqual([{ name: 'iot', options: { block: 'nearest', inline: 'nearest' } }])
    })

    it('竖向滚轮在标签页区上转成横向滚动；本来就横向的（触控板、Shift+滚轮）交给浏览器', async () => {
      const wrapper = mount(TabBar, { attachTo: document.body })
      const el = wrapper.find('[data-test=tab-scroller]').element as HTMLElement
      const scrollBy = vi.fn()
      el.scrollBy = scrollBy as unknown as typeof el.scrollBy

      const vertical = new WheelEvent('wheel', { deltaY: 120, cancelable: true })
      el.dispatchEvent(vertical)
      expect(scrollBy).toHaveBeenCalledWith({ left: 120 })
      expect(vertical.defaultPrevented).toBe(true)

      const horizontal = new WheelEvent('wheel', { deltaX: 80, deltaY: 10, cancelable: true })
      el.dispatchEvent(horizontal)
      expect(scrollBy).toHaveBeenCalledTimes(1)
      expect(horizontal.defaultPrevented).toBe(false)
      wrapper.unmount()
    })
  })
})
