import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PathStrip from '../../../src/renderer/src/components/PathStrip.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { installFakeApi, makeCommand, makeSession, makeSettings, makeTag } from '../fakeApi'

// happy-dom 没有 window.confirm，按需要的返回值打桩
function stubConfirm(result: boolean) {
  const fn = vi.fn(() => result)
  Object.defineProperty(window, 'confirm', { value: fn, configurable: true, writable: true })
  return fn
}

describe('PathStrip', () => {
  const session = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api' })
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionsStore().sessions = [session]
    useWorkspaceStore().select(session.id)
    writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('显示当前会话的完整路径；「复制」写入剪贴板并短暂显示「已复制」', async () => {
    vi.useFakeTimers()
    installFakeApi()
    const wrapper = mount(PathStrip)

    expect(wrapper.find('[data-test=strip-path]').text()).toBe('D:\\Projects\\simba\\api')

    const copy = wrapper.find('[data-test=strip-copy]')
    await copy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('D:\\Projects\\simba\\api')
    expect(copy.text()).toBe('已复制')

    await vi.advanceTimersByTimeAsync(1200)
    expect(copy.text()).toBe('复制')
  })

  it('「移除会话」按原型文案确认；确认后调 SDK 移除并关闭其标签页', async () => {
    const api = installFakeApi()
    const confirm = stubConfirm(true)
    const wrapper = mount(PathStrip)

    await wrapper.find('[data-test=strip-remove]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('移除会话 "simba-api"？终端进程会被结束。')
    expect(api.session.remove).toHaveBeenCalledWith(session.id)
    expect(useWorkspaceStore().activeId).toBeNull()
  })

  it('唤起区平铺 pinned 命令（显示名），点击即向终端写入 `<command>\r`；清屏按 shell 写 cls / clear', async () => {
    const api = installFakeApi()
    useSettingsStore().settings = makeSettings({
      launchCommands: [
        makeCommand({ command: 'pi', sortOrder: 2 }),
        makeCommand({ command: 'claude --continue', label: 'claude 续', sortOrder: 1 }),
      ],
    })
    const wrapper = mount(PathStrip)
    await flushPromises()

    const launchers = wrapper.findAll('[data-test=launch-cmd]')
    expect(launchers.map((b) => b.text())).toEqual(['claude 续', 'pi'])
    expect(wrapper.find('[data-test=launch-label]').text()).toBe('唤起')
    expect(wrapper.find('[data-test=launch-more]').exists()).toBe(false)

    await launchers[0]!.trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'claude --continue\r')

    await wrapper.find('[data-test=strip-clear]').trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'cls\r')

    useSessionsStore().sessions = [{ ...session, shell: 'powershell.exe' }]
    await flushPromises()
    await wrapper.find('[data-test=strip-clear]').trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'clear\r')
  })

  it('非 pinned 命令收进「更多 ▾」：点开列出、点选即执行并收起；没有任何命令时只剩「唤起」与「编辑」', async () => {
    const api = installFakeApi()
    const settings = useSettingsStore()
    settings.settings = makeSettings({
      launchCommands: [
        makeCommand({ command: 'claude', sortOrder: 1 }),
        makeCommand({ command: 'pi --model x', label: 'pi x', pinned: false, sortOrder: 2 }),
      ],
    })
    const wrapper = mount(PathStrip)
    await flushPromises()

    expect(wrapper.find('[data-test=launch-more-item]').exists()).toBe(false)
    await wrapper.find('[data-test=launch-more]').trigger('click')
    const items = wrapper.findAll('[data-test=launch-more-item]')
    expect(items.map((b) => b.text())).toEqual(['pi x'])
    await items[0]!.trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'pi --model x\r')
    expect(wrapper.find('[data-test=launch-more-item]').exists()).toBe(false)

    settings.settings = makeSettings({ launchCommands: [] })
    await flushPromises()
    expect(wrapper.find('[data-test=launch-cmd]').exists()).toBe(false)
    expect(wrapper.find('[data-test=launch-more]').exists()).toBe(false)
    expect(wrapper.find('[data-test=launch-label]').text()).toBe('唤起')
    expect(wrapper.find('[data-test=launch-edit]').text()).toBe('编辑')
    expect(wrapper.find('[data-test=strip-clear]').exists()).toBe(true)
    expect(wrapper.find('[data-test=strip-remove]').exists()).toBe(true)
  })

  it('「更多 ▾」弹出层：再点按钮或点击弹出层外部即收起', async () => {
    installFakeApi()
    useSettingsStore().settings = makeSettings({
      launchCommands: [makeCommand({ command: 'pi', pinned: false })],
    })
    const wrapper = mount(PathStrip, { attachTo: document.body })

    await wrapper.find('[data-test=launch-more]').trigger('click')
    expect(wrapper.find('[data-test=launch-more-pop]').exists()).toBe(true)
    await wrapper.find('[data-test=launch-more]').trigger('click')
    expect(wrapper.find('[data-test=launch-more-pop]').exists()).toBe(false)

    await wrapper.find('[data-test=launch-more]').trigger('click')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-test=launch-more-pop]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('「编辑」打开唤起命令弹窗，弹窗关闭后消失', async () => {
    installFakeApi()
    const wrapper = mount(PathStrip)

    expect(wrapper.find('[data-test=launch-modal]').exists()).toBe(false)
    await wrapper.find('[data-test=launch-edit]').trigger('click')
    expect(wrapper.find('[data-test=launch-modal]').exists()).toBe(true)

    await wrapper.find('[data-test=lc-cancel]').trigger('click')
    expect(wrapper.find('[data-test=launch-modal]').exists()).toBe(false)
  })

  it('取消确认则不移除', async () => {
    const api = installFakeApi()
    stubConfirm(false)
    const wrapper = mount(PathStrip)

    await wrapper.find('[data-test=strip-remove]').trigger('click')
    await flushPromises()

    expect(api.session.remove).not.toHaveBeenCalled()
    expect(useWorkspaceStore().activeId).toBe(session.id)
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
})
