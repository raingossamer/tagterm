import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LaunchBar from '../../../src/renderer/src/components/LaunchBar.vue'
import PathStrip from '../../../src/renderer/src/components/PathStrip.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { useAgentStore } from '../../../src/renderer/src/stores/agent'
import { installFakeApi, makeSession, makeTag } from '../fakeApi'
import { installFakeWorkspace } from '../fakeWorkspace'

describe('PathStrip', () => {
  const session = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api' })
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await installFakeWorkspace([session]).workspace.select(session.id)
    writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('路径只显示到第三级、tooltip 给完整路径；「复制」写入完整路径并短暂显示「已复制」', async () => {
    vi.useFakeTimers()
    installFakeApi()
    const wrapper = mount(PathStrip)

    // 假会话的 cwd 只有三级，原样显示；tooltip 始终是完整路径
    const path = wrapper.find('[data-test=strip-path]')
    expect(path.text()).toBe('D:\\Projects\\simba\\api')
    expect(path.attributes('title')).toBe(
      'D:\\Projects\\simba\\api\n会话固定在这个目录\n点击在资源管理器中打开',
    )

    const copy = wrapper.find('[data-test=strip-copy]')
    await copy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('D:\\Projects\\simba\\api')
    expect(copy.text()).toBe('已复制')

    await vi.advanceTimersByTimeAsync(1200)
    expect(copy.text()).toBe('复制')
  })

  it('更深的路径折成省略号，但复制的仍是完整路径', async () => {
    const deep = makeSession({
      name: '服务器提醒',
      cwd: 'C:\\Users\\21477\\Desktop\\Self-Project\\aly-Inform',
    })
    setActivePinia(createPinia())
    await installFakeWorkspace([deep]).workspace.select(deep.id)
    installFakeApi()
    const wrapper = mount(PathStrip)

    const path = wrapper.find('[data-test=strip-path]')
    expect(path.text()).toBe('C:\\Users\\21477\\Desktop\\…')
    expect(path.attributes('title')).toBe(
      'C:\\Users\\21477\\Desktop\\Self-Project\\aly-Inform\n会话固定在这个目录\n点击在资源管理器中打开',
    )

    await wrapper.find('[data-test=strip-copy]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('C:\\Users\\21477\\Desktop\\Self-Project\\aly-Inform')
  })

  it('路径 chip 是按钮：点它调 session.openDirectory（当前会话 id），tooltip 末行提示可点；不再有悬停「打开」；打不开时路径条红字 1.2 s', async () => {
    vi.useFakeTimers()
    const api = installFakeApi()
    const wrapper = mount(PathStrip)

    const path = wrapper.find('[data-test=strip-path]')
    expect(path.element.tagName).toBe('BUTTON')
    expect(path.attributes('title')?.split('\n').at(-1)).toBe('点击在资源管理器中打开')
    expect(wrapper.find('[data-test=strip-copy-wrap]').exists()).toBe(false)
    expect(wrapper.find('[data-test=strip-open]').exists()).toBe(false)

    await path.trigger('click')
    await flushPromises()
    expect(api.session.openDirectory).toHaveBeenCalledWith(session.id)
    expect(wrapper.find('[data-test=strip-error]').exists()).toBe(false)

    // 打不开（目录被删等）：主进程 reject 的中文 message 在路径条内红字显示 1.2 s
    vi.mocked(api.session.openDirectory).mockRejectedValueOnce(
      new Error('打不开目录：Failed to open path'),
    )
    await vi.advanceTimersByTimeAsync(500) // 过了双击冷却
    await path.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test=strip-error]').text()).toBe('打不开目录：Failed to open path')
    await vi.advanceTimersByTimeAsync(1200)
    expect(wrapper.find('[data-test=strip-error]').exists()).toBe(false)
  })

  it('唤起区（拖动唤起按钮后保存失败）上抛的原因显示成路径条红字 1.2 s', async () => {
    vi.useFakeTimers()
    installFakeApi()
    const wrapper = mount(PathStrip)

    wrapper.findComponent(LaunchBar).vm.$emit('error', '写入设置失败')
    await flushPromises()
    expect(wrapper.find('[data-test=strip-error]').text()).toBe('写入设置失败')
    await vi.advanceTimersByTimeAsync(1200)
    expect(wrapper.find('[data-test=strip-error]').exists()).toBe(false)
  })

  it('点 chip 后 500 ms 内的再次点击忽略（双击不会开两个资源管理器窗口），满 500 ms 再点才调第二次', async () => {
    vi.useFakeTimers()
    const api = installFakeApi()
    const wrapper = mount(PathStrip)
    const path = wrapper.find('[data-test=strip-path]')

    await path.trigger('click')
    await path.trigger('click')
    await flushPromises()
    expect(api.session.openDirectory).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(499)
    await path.trigger('click')
    expect(api.session.openDirectory).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await path.trigger('click')
    expect(api.session.openDirectory).toHaveBeenCalledTimes(2)
  })

  it('路径条不再有「移除会话」按钮（入口在左栏）；主进程广播移除后的列表到达时标签页关闭', async () => {
    installFakeApi()
    const wrapper = mount(PathStrip)

    expect(wrapper.find('[data-test=strip-remove]').exists()).toBe(false)
    expect(wrapper.find('[data-test=launch-label]').text()).toBe('唤起') // 唤起区（LaunchBar）在路径条右侧
    expect(useWorkspaceStore().activeId).toBe(session.id)

    useSessionsStore().sessions = []
    await flushPromises()
    expect(useWorkspaceStore().activeId).toBeNull()
    expect(wrapper.find('[data-test=strip-path]').exists()).toBe(false)
  })

  it('标签胶囊按 sortOrder 显示（带色），点 × 调 tag.detach；「+ 标签」打开弹出层，点击外部 / Esc 关闭', async () => {
    const api = installFakeApi()
    const java = makeTag({ name: 'java', color: '#C98A0C', sortOrder: 2 })
    const simba = makeTag({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })
    const tags = useTagsStore()
    tags.tags = [java, simba]
    tags.sessionTags = [
      { sessionId: session.id, tagId: java.id },
      { sessionId: session.id, tagId: simba.id },
    ]
    const wrapper = mount(PathStrip, { attachTo: document.body })

    const pills = wrapper.findAll('[data-test=strip-tag]')
    expect(pills.map((p) => p.text())).toEqual(['simba×', 'java×'])
    expect(pills[0]!.attributes('style')).toContain('#2F6FDB')
    expect(pills[0]!.find('[data-test=strip-untag]').attributes('title')).toBe('从这个标签移除')
    await pills[1]!.find('[data-test=strip-untag]').trigger('click')
    expect(api.tag.detach).toHaveBeenCalledWith(session.id, java.id)

    const add = wrapper.find('[data-test=strip-add-tag]')
    expect(add.text()).toBe('+ 标签')
    expect(wrapper.find('[data-test=tag-pop]').exists()).toBe(false)
    await add.trigger('click')
    expect(wrapper.find('[data-test=tag-pop]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test=tag-pop-opt]')).toHaveLength(2)

    // 点弹出层内部不关闭；点击外部关闭
    wrapper
      .find('[data-test=tag-pop]')
      .element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-test=tag-pop]').exists()).toBe(true)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-test=tag-pop]').exists()).toBe(false)

    // Esc 关闭
    await add.trigger('click')
    expect(wrapper.find('[data-test=tag-pop]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-test=tag-pop]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('有追踪到的当前目录（cwdNow）时路径条显示它（同样缩略），tooltip 第一行当前目录、第二行固定目录；「复制」仍复制当前目录；没有则显示固定目录', async () => {
    installFakeApi()
    const agent = useAgentStore()
    const wrapper = mount(PathStrip)
    expect(wrapper.find('[data-test=strip-path]').text()).toBe('D:\\Projects\\simba\\api')

    agent.runtime = {
      [session.id]: {
        sessionId: session.id,
        alive: true,
        agent: null,
        status: 'idle',
        cwdNow: 'C:\\Users\\k\\Desktop\\deep\\dir',
      },
    }
    await flushPromises()
    const path = wrapper.find('[data-test=strip-path]')
    expect(path.text()).toBe('C:\\Users\\k\\Desktop\\…')
    expect(path.attributes('title')).toBe(
      'C:\\Users\\k\\Desktop\\deep\\dir\n会话固定在：D:\\Projects\\simba\\api\n点击在资源管理器中打开',
    )
    await wrapper.find('[data-test=strip-copy]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('C:\\Users\\k\\Desktop\\deep\\dir')

    // 当前目录又回到固定目录：tooltip 回到单行说明
    agent.runtime = {
      [session.id]: {
        sessionId: session.id,
        alive: true,
        agent: null,
        status: 'idle',
        cwdNow: session.cwd,
      },
    }
    await flushPromises()
    expect(wrapper.find('[data-test=strip-path]').attributes('title')).toBe(
      'D:\\Projects\\simba\\api\n会话固定在这个目录\n点击在资源管理器中打开',
    )
  })
})
