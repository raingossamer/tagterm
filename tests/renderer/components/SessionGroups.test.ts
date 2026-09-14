import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import SessionGroups from '../../../src/renderer/src/components/SessionGroups.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { useFilterStore } from '../../../src/renderer/src/stores/filter'
import { installFakeApi, makeSession, makeTag } from '../fakeApi'
import { installFakeWorkspace } from '../fakeWorkspace'

// happy-dom 没有 window.confirm，按需要的返回值打桩
function stubConfirm(result: boolean) {
  const fn = vi.fn(() => result)
  Object.defineProperty(window, 'confirm', { value: fn, configurable: true, writable: true })
  return fn
}

describe('SessionGroups', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('右键菜单「移除会话」：按原型文案确认；确认后调 SDK 移除，取消则不调', async () => {
    const s = makeSession({ name: 'simba-api' })
    useSessionsStore().sessions = [s]
    const api = installFakeApi()
    const confirm = stubConfirm(true)
    const wrapper = mount(SessionGroups, { attachTo: document.body })
    const openMenu = async () => {
      wrapper
        .find('[data-test=session-row]')
        .element.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 10,
            clientY: 10,
          }),
        )
      await nextTick()
    }

    await openMenu()
    await wrapper.find('[data-test=menu-remove]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith('移除会话 "simba-api"？终端进程会被结束。')
    expect(api.session.remove).toHaveBeenCalledWith(s.id)
    expect(wrapper.emitted('select')).toBeUndefined()

    stubConfirm(false)
    vi.mocked(api.session.remove).mockClear()
    await openMenu()
    await wrapper.find('[data-test=menu-remove]').trigger('click')
    await flushPromises()
    expect(api.session.remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('右键行：菜单出现在鼠标位置且该行成为悬停对象；「编辑会话」发出 edit 并关菜单；「移除会话」走同一确认；Esc / 点外部关闭', async () => {
    const s = makeSession({ name: 'simba-api' })
    useSessionsStore().sessions = [s]
    const api = installFakeApi()
    const wrapper = mount(SessionGroups, { attachTo: document.body })
    const rightClick = async () => {
      wrapper.find('[data-test=session-row]').element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 30,
          clientY: 40,
        }),
      )
      await nextTick()
    }
    const menu = () => wrapper.find('[data-test=session-menu]')
    expect(menu().exists()).toBe(false)

    await rightClick()
    expect(menu().exists()).toBe(true)
    expect(menu().attributes('style')).toContain('left: 30px')
    expect(menu().attributes('style')).toContain('top: 40px')
    expect(useWorkspaceStore().hoveredId).toBe(s.id)
    expect(menu().find('[data-test=menu-edit]').text()).toBe('编辑会话')
    expect(menu().find('[data-test=menu-remove]').text()).toBe('移除会话')

    await menu().find('[data-test=menu-edit]').trigger('click')
    expect(wrapper.emitted('edit')).toEqual([[s.id]])
    expect(menu().exists()).toBe(false)

    await rightClick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(menu().exists()).toBe(false)

    await rightClick()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(menu().exists()).toBe(false)

    await rightClick()
    stubConfirm(true)
    await menu().find('[data-test=menu-remove]').trigger('click')
    await flushPromises()
    expect(api.session.remove).toHaveBeenCalledWith(s.id)
    expect(menu().exists()).toBe(false)
    wrapper.unmount()
  })

  it('按 sortOrder 平铺每个会话：名称 + 路径末两段；active 行高亮；点击行发出 select', async () => {
    const a = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api', sortOrder: 2 })
    const b = makeSession({ name: 'iot', cwd: 'C:\\work\\iot\\', sortOrder: 1 })
    useSessionsStore().sessions = [a, b]
    await installFakeWorkspace().workspace.select(a.id)

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

  it('分组随 filter store 的选中 / 模式 / 搜索词变化：任一 → 只剩选中标签组；搜索无匹配 → 整体空态', async () => {
    const s1 = makeSession({ name: 'api', sortOrder: 1 })
    const s2 = makeSession({ name: 'web', sortOrder: 2 })
    useSessionsStore().sessions = [s1, s2]
    const simba = makeTag({ name: 'simba', sortOrder: 1 })
    const java = makeTag({ name: 'java', sortOrder: 2 })
    const tags = useTagsStore()
    tags.tags = [simba, java]
    tags.sessionTags = [
      { sessionId: s1.id, tagId: simba.id },
      { sessionId: s2.id, tagId: java.id },
    ]
    tags.sessionTags.push({ sessionId: s1.id, tagId: java.id })
    const filter = useFilterStore()
    const wrapper = mount(SessionGroups)
    const titles = () => wrapper.findAll('[data-test=group-title]').map((t) => t.text())
    expect(titles()).toEqual(['simba', 'java'])

    filter.toggle(simba.id)
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['simba'])

    filter.toggle(java.id)
    filter.setMode('all')
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['simba ∩ java'])
    expect(wrapper.findAll('[data-test=session-row]').map((r) => r.text())).toEqual([
      expect.stringContaining('api'),
    ])

    filter.clear()
    filter.setSearch('zzz')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-test=group-head]')).toHaveLength(0)
    expect(wrapper.text()).toContain('没有匹配的会话。换个标签组合，或新建一个会话。')
  })
})
