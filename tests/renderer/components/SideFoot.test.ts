import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SideFoot from '../../../src/renderer/src/components/SideFoot.vue'

describe('SideFoot', () => {
  it('「新建会话」与「管理标签」各自发出事件', async () => {
    const wrapper = mount(SideFoot)
    expect(wrapper.find('[data-test=new-session]').text()).toBe('新建会话')
    expect(wrapper.find('[data-test=manage-tags]').text()).toBe('管理标签')
    await wrapper.find('[data-test=new-session]').trigger('click')
    await wrapper.find('[data-test=manage-tags]').trigger('click')
    expect(wrapper.emitted('newSession')).toHaveLength(1)
    expect(wrapper.emitted('manageTags')).toHaveLength(1)
  })
})
