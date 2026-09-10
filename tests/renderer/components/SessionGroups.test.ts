import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SessionGroups from '../../../src/renderer/src/components/SessionGroups.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { makeSession } from '../fakeApi'

describe('SessionGroups（M1 平铺）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('按 sortOrder 平铺每个会话：名称 + 路径末两段；active 行高亮；点击行发出 select', async () => {
    const a = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api', sortOrder: 2 })
    const b = makeSession({ name: 'iot', cwd: 'C:\\work\\iot\\', sortOrder: 1 })
    useSessionsStore().sessions = [a, b]
    useWorkspaceStore().activeId = a.id

    const wrapper = mount(SessionGroups)
    const rows = wrapper.findAll('[data-test=session-row]')

    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('iot')
    expect(rows[0]!.find('[data-test=row-path]').text()).toBe('work\\iot')
    expect(rows[1]!.find('[data-test=row-path]').text()).toBe('simba\\api')
    expect(rows[1]!.classes()).toContain('active')
    expect(rows[0]!.classes()).not.toContain('active')
    expect(rows[1]!.attributes('title')).toBe('D:\\Projects\\simba\\api')

    await rows[0]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[b.id]])
  })

  it('没有会话时显示原型的空态文案', () => {
    const wrapper = mount(SessionGroups)
    expect(wrapper.text()).toContain('没有匹配的会话。换个标签组合，或新建一个会话。')
  })
})
