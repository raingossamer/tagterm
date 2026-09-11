import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TagFilter from '../../../src/renderer/src/components/TagFilter.vue'
import { useFilterStore } from '../../../src/renderer/src/stores/filter'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { makeSession, makeTag } from '../fakeApi'

describe('TagFilter', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('chips = 色点 + 名 + 会话数（按标签 sortOrder，计数不受筛选影响）；点击切换选中；「清除」只在有选中时可见', async () => {
    const s1 = makeSession()
    const s2 = makeSession()
    useSessionsStore().sessions = [s1, s2]
    const java = makeTag({ name: 'java', color: '#C98A0C', sortOrder: 2 })
    const simba = makeTag({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })
    const tags = useTagsStore()
    tags.tags = [java, simba]
    tags.sessionTags = [
      { sessionId: s1.id, tagId: simba.id },
      { sessionId: s1.id, tagId: java.id },
      { sessionId: s2.id, tagId: java.id },
    ]
    const filter = useFilterStore()

    const wrapper = mount(TagFilter)
    expect(wrapper.text()).toContain('按标签筛选')
    const chips = wrapper.findAll('[data-test=tag-chip]')
    expect(chips.map((c) => c.text())).toEqual(['simba1', 'java2'])
    expect(chips[0]!.attributes('style')).toContain('#2F6FDB')
    expect(wrapper.find('[data-test=filter-clear]').attributes('style')).toContain(
      'visibility: hidden',
    )

    await chips[0]!.trigger('click')
    expect(filter.selected).toEqual(new Set([simba.id]))
    expect(chips[0]!.classes()).toContain('on')
    expect(chips[1]!.classes()).not.toContain('on')
    expect(chips.map((c) => c.find('[data-test=chip-count]').text())).toEqual(['1', '2'])
    expect(wrapper.find('[data-test=filter-clear]').attributes('style')).toContain(
      'visibility: visible',
    )

    await wrapper.find('[data-test=filter-clear]').trigger('click')
    expect(filter.selected.size).toBe(0)
    expect(chips[0]!.classes()).not.toContain('on')
  })

  it('「任一 / 全部」分段切换模式', async () => {
    const filter = useFilterStore()
    const wrapper = mount(TagFilter)
    expect(wrapper.find('[data-test=mode-any]').classes()).toContain('on')
    await wrapper.find('[data-test=mode-all]').trigger('click')
    expect(filter.mode).toBe('all')
    expect(wrapper.find('[data-test=mode-all]').classes()).toContain('on')
    expect(wrapper.find('[data-test=mode-any]').classes()).not.toContain('on')
  })

  it('没有标签时显示提示文案', () => {
    const wrapper = mount(TagFilter)
    expect(wrapper.find('[data-test=filter-hint]').text()).toBe('还没有标签，在"管理标签"里创建')
    expect(wrapper.findAll('[data-test=tag-chip]')).toHaveLength(0)
  })
})
