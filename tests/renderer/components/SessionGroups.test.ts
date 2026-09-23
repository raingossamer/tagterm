import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import SessionGroups from '../../../src/renderer/src/components/SessionGroups.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { useFilterStore } from '../../../src/renderer/src/stores/filter'
import { useAgentStore } from '../../../src/renderer/src/stores/agent'
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
      wrapper.find('[data-test=session-row]').element.dispatchEvent(
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

  describe('右键菜单「重启终端」', () => {
    const s = makeSession({ name: 'simba-api', sortOrder: 1 })
    const t = makeSession({ name: 'simba-web', sortOrder: 2 })
    /** 右键 id 对应的那一行（「未打标签」组里按 sortOrder：s 在前、t 在后） */
    async function rightClick(wrapper: ReturnType<typeof mount>, id: string): Promise<void> {
      wrapper.findAll('[data-test=session-row]')[[s.id, t.id].indexOf(id)]!.element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 5,
          clientY: 5,
        }),
      )
      await nextTick()
    }

    it('排在「编辑会话」与「移除会话」之间；终端还没打开时置灰（悬停「终端还没打开」）点了不动；打开后空闲直接重启并切过去', async () => {
      installFakeApi()
      const { pty, workspace } = installFakeWorkspace([s, t])
      const wrapper = mount(SessionGroups, { attachTo: document.body })

      await rightClick(wrapper, s.id)
      const items = wrapper.findAll('[data-test=session-menu] button')
      expect(items.map((b) => b.text())).toEqual(['编辑会话', '重启终端', '移除会话'])
      const restart = wrapper.find('[data-test=menu-restart]')
      expect(restart.attributes('aria-disabled')).toBe('true')
      expect(restart.attributes('title')).toBe('终端还没打开')
      await restart.trigger('click')
      await flushPromises()
      expect(pty.kills).toEqual([])

      await workspace.select(s.id)
      await workspace.select(t.id)
      const confirm = stubConfirm(true)
      await rightClick(wrapper, s.id)
      expect(wrapper.find('[data-test=menu-restart]').attributes('aria-disabled')).toBeUndefined()
      await wrapper.find('[data-test=menu-restart]').trigger('click')
      await flushPromises()
      expect(confirm).not.toHaveBeenCalled() // 空闲：不问
      expect(pty.kills).toEqual([s.id])
      expect(pty.spawnCount(s.id)).toBe(2)
      expect(workspace.activeId).toBe(s.id)
      expect(wrapper.find('[data-test=session-menu]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('有程序在跑：确认框写出程序名（认出的工具用正式名称），取消不动、确定才重启；已退出的终端直接重启不问；重启失败左栏顶部红字', async () => {
      installFakeApi()
      const { pty, workspace } = installFakeWorkspace([s, t])
      const agent = useAgentStore()
      const wrapper = mount(SessionGroups, { attachTo: document.body })
      await workspace.select(s.id)
      agent.runtime = {
        [s.id]: { sessionId: s.id, alive: true, agent: null, status: 'idle', program: 'node' },
      }

      let confirm = stubConfirm(false)
      await rightClick(wrapper, s.id)
      await wrapper.find('[data-test=menu-restart]').trigger('click')
      await flushPromises()
      expect(confirm).toHaveBeenCalledWith('终端里有程序在运行（node），重启会结束它。继续？')
      expect(pty.kills).toEqual([])

      agent.runtime = {
        [s.id]: {
          sessionId: s.id,
          alive: true,
          agent: 'claude',
          status: 'working',
          program: 'claude',
        },
      }
      confirm = stubConfirm(true)
      await rightClick(wrapper, s.id)
      await wrapper.find('[data-test=menu-restart]').trigger('click')
      await flushPromises()
      expect(confirm).toHaveBeenCalledWith(
        '终端里有程序在运行（Claude Code），重启会结束它。继续？',
      )
      expect(pty.kills).toEqual([s.id])

      // 已退出（显示「[进程已退出]」）：镜像里就算还残留程序名也不问
      pty.emitExit(s.id, 0)
      confirm = stubConfirm(true)
      await rightClick(wrapper, s.id)
      await wrapper.find('[data-test=menu-restart]').trigger('click')
      await flushPromises()
      expect(confirm).not.toHaveBeenCalled()
      expect(pty.spawnCount(s.id)).toBe(3)

      vi.spyOn(pty, 'kill').mockRejectedValueOnce(new Error('结束终端失败'))
      agent.runtime = {}
      await rightClick(wrapper, s.id)
      await wrapper.find('[data-test=menu-restart]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test=groups-error]').text()).toBe('结束终端失败')
      wrapper.unmount()
    })
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

  it('会话行上不画标签色点；同一会话出现在它所有标签的组下，多标签时 tooltip 追加「同时在：a、b」', () => {
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
    // 行上不再画标签色点（与状态色撞车）：挂了哪些标签由所在分组与 tooltip「同时在」表达
    for (const row of iotRows) {
      expect(row.find('[data-test=row-tag-dot]').exists()).toBe(false)
      expect(row.attributes('title')).toBe(`C:/work/iot
同时在：simba、java`)
    }
    expect(apiRows[0]!.find('[data-test=row-tag-dot]').exists()).toBe(false)
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
    // 无色点的组仍留出色点的位置，所有组名同一列起（会话行按组名对齐）
    expect(groups[2]!.find('[data-test=group-dot-blank]').exists()).toBe(true)
    expect(groups[0]!.find('[data-test=group-dot-blank]').exists()).toBe(false)
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

  it('组内拖拽：按槽位置换算出新的全局顺序调 session.reorder，组外会话位置不动', async () => {
    // 全局顺序 a b c d；iot 组 = a c（占第 1、3 位），把 c 拖到组内第一位 → 全局 c b a d
    const [a, b, c, d] = [
      makeSession({ name: 'a', sortOrder: 1 }),
      makeSession({ name: 'b', sortOrder: 2 }),
      makeSession({ name: 'c', sortOrder: 3 }),
      makeSession({ name: 'd', sortOrder: 4 }),
    ]
    const iot = makeTag({ name: 'iot', sortOrder: 1 })
    useSessionsStore().sessions = [a!, b!, c!, d!]
    const tags = useTagsStore()
    tags.tags = [iot]
    tags.sessionTags = [
      { sessionId: a!.id, tagId: iot.id },
      { sessionId: c!.id, tagId: iot.id },
    ]
    const api = installFakeApi()
    const wrapper = mount(SessionGroups)

    const iotRows = wrapper.findAll('[data-test=group]')[0]!.findAll('[data-test=session-row]')
    expect(iotRows).toHaveLength(2)
    await iotRows[1]!.trigger('dragstart')
    await iotRows[0]!.trigger('drop')
    await flushPromises()

    expect(api.session.reorder).toHaveBeenCalledWith([c!.id, b!.id, a!.id, d!.id])
  })

  it('跨组拖拽不生效：起点与落点不在同一个组时不调 reorder', async () => {
    const [a, b] = [
      makeSession({ name: 'a', sortOrder: 1 }),
      makeSession({ name: 'b', sortOrder: 2 }),
    ]
    const iot = makeTag({ name: 'iot', sortOrder: 1 })
    const py = makeTag({ name: 'python', sortOrder: 2 })
    useSessionsStore().sessions = [a!, b!]
    const tags = useTagsStore()
    tags.tags = [iot, py]
    tags.sessionTags = [
      { sessionId: a!.id, tagId: iot.id },
      { sessionId: b!.id, tagId: py.id },
    ]
    const api = installFakeApi()
    const wrapper = mount(SessionGroups)

    const groups = wrapper.findAll('[data-test=group]')
    await groups[0]!.find('[data-test=session-row]').trigger('dragstart')
    await groups[1]!.find('[data-test=session-row]').trigger('drop')
    await flushPromises()

    expect(api.session.reorder).not.toHaveBeenCalled()
  })

  it('左栏正在搜索时行不可拖（组内只剩子集）', async () => {
    const s = makeSession({ name: 'simba-api' })
    useSessionsStore().sessions = [s]
    installFakeApi()
    const wrapper = mount(SessionGroups)
    expect(wrapper.find('[data-test=session-row]').attributes('draggable')).toBe('true')

    useFilterStore().setSearch('simba')
    await nextTick()
    expect(wrapper.find('[data-test=session-row]').attributes('draggable')).toBe('false')
  })

  it('reorder 失败时列表顶部显示红字，1.2 s 后消失', async () => {
    vi.useFakeTimers()
    const [a, b] = [
      makeSession({ name: 'a', sortOrder: 1 }),
      makeSession({ name: 'b', sortOrder: 2 }),
    ]
    useSessionsStore().sessions = [a!, b!]
    installFakeApi({ session: { reorder: async () => Promise.reject(new Error('排序参数不对')) } })
    const wrapper = mount(SessionGroups)

    const rows = wrapper.findAll('[data-test=session-row]')
    await rows[1]!.trigger('dragstart')
    await rows[0]!.trigger('drop')
    await flushPromises()
    expect(wrapper.find('[data-test=groups-error]').text()).toBe('排序参数不对')

    vi.advanceTimersByTime(1200)
    await nextTick()
    expect(wrapper.find('[data-test=groups-error]').exists()).toBe(false)
    vi.useRealTimers()
  })

  it('每行的状态点取 agent store：同一会话在多个分组里的副本状态一致，无记录为 idle', () => {
    installFakeApi()
    const s1 = makeSession({ name: 'iot', sortOrder: 1 })
    const s2 = makeSession({ name: 'api', sortOrder: 2 })
    useSessionsStore().sessions = [s1, s2]
    const java = makeTag({ name: 'java', sortOrder: 2 })
    const simba = makeTag({ name: 'simba', sortOrder: 1 })
    const tags = useTagsStore()
    tags.tags = [java, simba]
    tags.sessionTags = [
      { sessionId: s1.id, tagId: java.id },
      { sessionId: s1.id, tagId: simba.id },
      { sessionId: s2.id, tagId: java.id },
    ]
    const agent = useAgentStore()
    agent.runtime = { [s1.id]: { sessionId: s1.id, alive: true, agent: 'claude', status: 'done' } }

    const rows = mount(SessionGroups).findAll('[data-test=session-row]')
    const dotsOfIot = rows
      .filter((r) => r.text().includes('iot'))
      .map((r) => r.find('.dot').classes())
    expect(dotsOfIot).toHaveLength(2)
    expect(dotsOfIot.every((c) => c.includes('done'))).toBe(true)
    const dotsOfApi = rows
      .filter((r) => r.text().includes('api'))
      .map((r) => r.find('.dot').classes())
    expect(dotsOfApi).toHaveLength(1)
    expect(dotsOfApi[0]).toContain('idle')
  })
})
