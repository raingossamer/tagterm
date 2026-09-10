import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TabBar from '../../../src/renderer/src/components/TabBar.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { installFakeApi, makeSession } from '../fakeApi'

describe('TabBar', () => {
  const a = makeSession({ name: 'simba-api' })
  const b = makeSession({ name: 'iot' })

  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionsStore().sessions = [a, b]
    const ws = useWorkspaceStore()
    ws.select(a.id)
    ws.select(b.id)
    ws.select(a.id)
  })

  it('为每个打开的标签页渲染名称与状态点，当前页高亮；点击 / Enter 选中标签页', async () => {
    installFakeApi()
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

  it('× 只关闭标签页（会话继续在后台保持）：不调 pty.kill，active 切到邻居', async () => {
    const api = installFakeApi()
    const wrapper = mount(TabBar)

    await wrapper.findAll('[data-test=tab-close]')[0]!.trigger('click')

    const ws = useWorkspaceStore()
    expect(ws.openTabs).toEqual([b.id])
    expect(ws.activeId).toBe(b.id)
    expect(api.pty.kill).not.toHaveBeenCalled()
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('☰ 切换侧栏收起；＋ 发出 newSession', async () => {
    installFakeApi()
    const wrapper = mount(TabBar)

    await wrapper.find('[data-test=tab-side]').trigger('click')
    expect(useWorkspaceStore().sideHidden).toBe(true)

    await wrapper.find('[data-test=tab-add]').trigger('click')
    expect(wrapper.emitted('newSession')).toHaveLength(1)
  })
})
