import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SessionGroups from '../../../src/renderer/src/components/SessionGroups.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { useFilterStore } from '../../../src/renderer/src/stores/filter'
import { makeSession, makeTag } from '../fakeApi'

describe('SessionGroups', () => {
  beforeEach(() => {
    localStorage.clear()
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

    // s1 同时在 simba / java 两组各出现一次，s2 只在 java 组
    const rows = mount(SessionGroups).findAll('[data-test=session-row]')
    const iotRows = rows.filter((r) => r.text().includes('iot'))
    const apiRows = rows.filter((r) => r.text().includes('api'))
    expect(iotRows).toHaveLength(2)
    expect(apiRows).toHaveLength(1)
    for (const row of iotRows) {
      expect(row.findAll('[data-test=row-tag-dot]').map((d) => d.attributes('style'))).toEqual([
        'background: #2F6FDB;',
        'background: #C98A0C;',
      ])
      expect(row.attributes('title')).toBe(`C:/work/iot
同时在：simba、java`)
    }
    expect(apiRows[0]!.findAll('[data-test=row-tag-dot]')).toHaveLength(1)
    expect(apiRows[0]!.attributes('title')).toBe('C:/work/api')
  })

  it('按标签分组：分组头 = 色点 + 名称 + 数量，未打标签组无色点；点击分组头折叠 / 展开并记入 filter store；组内无会话显示空态', async () => {
    const s1 = makeSession({ name: 'api', sortOrder: 1 })
    const s2 = makeSession({ name: 'web', sortOrder: 2 })
    useSessionsStore().sessions = [s1, s2]
    const simba = makeTag({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })
    const java = makeTag({ name: 'java', color: '#C98A0C', sortOrder: 2 })
    const tags = useTagsStore()
    tags.tags = [java, simba]
    tags.sessionTags = [{ sessionId: s1.id, tagId: simba.id }]

    const wrapper = mount(SessionGroups)
    const groups = wrapper.findAll('[data-test=group]')
    expect(groups.map((g) => g.find('[data-test=group-title]').text())).toEqual([
      'simba',
      'java',
      '未打标签',
    ])
    expect(groups.map((g) => g.find('[data-test=group-count]').text())).toEqual(['1', '0', '1'])
    expect(groups[0]!.find('[data-test=group-dot]').attributes('style')).toContain('#2F6FDB')
    expect(groups[2]!.find('[data-test=group-dot]').exists()).toBe(false)
    const simbaRows = groups[0]!.findAll('[data-test=session-row]')
    expect(simbaRows).toHaveLength(1)
    expect(simbaRows[0]!.text()).toContain('api')
    expect(groups[1]!.find('[data-test=group-empty]').text()).toBe('这个标签下还没有会话')
    expect(groups[0]!.find('[data-test=group-empty]').exists()).toBe(false)

    expect(groups[0]!.classes()).toContain('open')
    await groups[0]!.find('[data-test=group-head]').trigger('click')
    expect(groups[0]!.classes()).not.toContain('open')
    expect(useFilterStore().isCollapsed(simba.id)).toBe(true)
    await groups[0]!.find('[data-test=group-head]').trigger('click')
    expect(groups[0]!.classes()).toContain('open')
  })

  it('有标签但没有任何会话时显示整体空态，不渲染分组头', () => {
    useTagsStore().tags = [makeTag({ name: 'simba' })]
    const wrapper = mount(SessionGroups)
    expect(wrapper.text()).toContain('没有匹配的会话。换个标签组合，或新建一个会话。')
    expect(wrapper.findAll('[data-test=group-head]')).toHaveLength(0)
  })

  it('没有任何标签时与 M1 等价：只有一个「未打标签」分组头', () => {
    useSessionsStore().sessions = [makeSession()]
    const wrapper = mount(SessionGroups)
    expect(wrapper.findAll('[data-test=group-head]').map((h) => h.text())).toEqual(['未打标签1'])
  })

  it('hover 某行时同一会话在其他组的副本一起带 peer 高亮，离开后消失；hoveredId 记在 workspace store', async () => {
    const s1 = makeSession({ name: 'api', sortOrder: 1 })
    const s2 = makeSession({ name: 'web', sortOrder: 2 })
    useSessionsStore().sessions = [s1, s2]
    const simba = makeTag({ name: 'simba', sortOrder: 1 })
    const java = makeTag({ name: 'java', sortOrder: 2 })
    const tags = useTagsStore()
    tags.tags = [simba, java]
    tags.sessionTags = [
      { sessionId: s1.id, tagId: simba.id },
      { sessionId: s1.id, tagId: java.id },
      { sessionId: s2.id, tagId: java.id },
    ]

    const wrapper = mount(SessionGroups)
    const rows = wrapper.findAll('[data-test=session-row]')
    const apiRows = rows.filter((r) => r.text().includes('api'))
    const webRow = rows.find((r) => r.text().includes('web'))!
    expect(apiRows).toHaveLength(2)

    await apiRows[0]!.trigger('mouseenter')
    expect(useWorkspaceStore().hoveredId).toBe(s1.id)
    expect(apiRows.map((r) => r.classes().includes('peer'))).toEqual([true, true])
    expect(webRow.classes()).not.toContain('peer')

    await apiRows[0]!.trigger('mouseleave')
    expect(useWorkspaceStore().hoveredId).toBeNull()
    expect(apiRows.map((r) => r.classes().includes('peer'))).toEqual([false, false])
  })
})
