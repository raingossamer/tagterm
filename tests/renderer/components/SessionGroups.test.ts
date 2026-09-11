import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SessionGroups from '../../../src/renderer/src/components/SessionGroups.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { makeSession, makeTag } from '../fakeApi'

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

  it('会话行右侧按标签 sortOrder 显示色点；多标签时 tooltip 追加「同时在：a、b」', () => {
    const s1 = makeSession({ name: 'iot', cwd: 'C:/work/iot', sortOrder: 1 })
    const s2 = makeSession({ name: 'api', cwd: 'C:/work/api', sortOrder: 2 })
    useSessionsStore().sessions = [s1, s2]
    const java = makeTag({ name: 'java', color: '#C98A0C', sortOrder: 2 })
    const simba = makeTag({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })
    const tags = useTagsStore()
    tags.tags = [java, simba]
    tags.sessionTags = [
      { sessionId: s1.id, tagId: java.id },
      { sessionId: s1.id, tagId: simba.id },
      { sessionId: s2.id, tagId: java.id },
    ]

    const rows = mount(SessionGroups).findAll('[data-test=session-row]')
    const dots1 = rows[0]!.findAll('[data-test=row-tag-dot]')
    expect(dots1.map((d) => d.attributes('style'))).toEqual([
      'background: #2F6FDB;',
      'background: #C98A0C;',
    ])
    expect(rows[0]!.attributes('title')).toBe(`C:/work/iot
同时在：simba、java`)
    expect(rows[1]!.findAll('[data-test=row-tag-dot]')).toHaveLength(1)
    expect(rows[1]!.attributes('title')).toBe('C:/work/api')
  })
})
