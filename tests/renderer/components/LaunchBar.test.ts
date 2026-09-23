import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LaunchBar from '../../../src/renderer/src/components/LaunchBar.vue'
import { useAgentStore } from '../../../src/renderer/src/stores/agent'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { installFakeApi, makeCommand, makeSession, makeSettings } from '../fakeApi'

describe('LaunchBar（路径条右侧的唤起区）', () => {
  const session = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api' })

  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('唤起区平铺 pinned 命令（显示名），点击即向终端写入 `<command>\r`；清屏按 shell 写 cls / clear', async () => {
    const api = installFakeApi()
    useSettingsStore().settings = makeSettings({
      launchCommands: [
        makeCommand({ command: 'pi', sortOrder: 2 }),
        makeCommand({ command: 'claude --continue', label: 'claude 续', sortOrder: 1 }),
      ],
    })
    const wrapper = mount(LaunchBar, { props: { session } })
    await flushPromises()

    const launchers = wrapper.findAll('[data-test=launch-cmd]')
    expect(launchers.map((b) => b.text())).toEqual(['claude 续', 'pi'])
    expect(wrapper.find('[data-test=launch-label]').text()).toBe('唤起')
    expect(wrapper.find('[data-test=launch-more]').exists()).toBe(false)

    await launchers[0]!.trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'claude --continue\r')

    await wrapper.find('[data-test=strip-clear]').trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'cls\r')

    await wrapper.setProps({ session: { ...session, shell: 'powershell.exe' } })
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
    const wrapper = mount(LaunchBar, { props: { session } })
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
  })

  it('「更多 ▾」弹出层：再点按钮或点击弹出层外部即收起', async () => {
    installFakeApi()
    useSettingsStore().settings = makeSettings({
      launchCommands: [makeCommand({ command: 'pi', pinned: false })],
    })
    const wrapper = mount(LaunchBar, { props: { session }, attachTo: document.body })

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
    const wrapper = mount(LaunchBar, { props: { session } })

    expect(wrapper.find('[data-test=launch-modal]').exists()).toBe(false)
    await wrapper.find('[data-test=launch-edit]').trigger('click')
    expect(wrapper.find('[data-test=launch-modal]').exists()).toBe(true)

    await wrapper.find('[data-test=lc-cancel]').trigger('click')
    expect(wrapper.find('[data-test=launch-modal]').exists()).toBe(false)
  })

  it('终端里有程序在跑：平铺按钮、「更多」里的项、清屏置灰且点了不写终端，悬停「当前在 <名> 里，退出后再用」；「唤起」「编辑」「更多 ▾」照常；程序退出后恢复', async () => {
    const api = installFakeApi()
    useSettingsStore().settings = makeSettings({
      launchCommands: [
        makeCommand({ command: 'claude', sortOrder: 1 }),
        makeCommand({ command: 'pi', pinned: false, sortOrder: 2 }),
      ],
    })
    const agent = useAgentStore()
    agent.runtime = {
      [session.id]: {
        sessionId: session.id,
        alive: true,
        agent: 'claude',
        status: 'working',
        program: 'claude',
      },
    }
    const wrapper = mount(LaunchBar, { props: { session } })
    await flushPromises()

    const busyTitle = '当前在 Claude Code 里，退出后再用'
    const launcher = wrapper.find('[data-test=launch-cmd]')
    const clear = wrapper.find('[data-test=strip-clear]')
    for (const b of [launcher, clear]) {
      expect(b.attributes('aria-disabled')).toBe('true')
      expect(b.attributes('title')).toBe(busyTitle)
      await b.trigger('click')
    }
    await wrapper.find('[data-test=launch-more]').trigger('click')
    const item = wrapper.find('[data-test=launch-more-item]')
    expect(item.attributes('aria-disabled')).toBe('true')
    expect(item.attributes('title')).toBe(busyTitle)
    await item.trigger('click')
    expect(api.pty.write).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test=launch-label]').text()).toBe('唤起')
    expect(wrapper.find('[data-test=launch-edit]').attributes('aria-disabled')).toBeUndefined()
    expect(wrapper.find('[data-test=launch-more]').attributes('aria-disabled')).toBeUndefined()

    // 认不出的程序：提示里是进程名
    agent.runtime = {
      [session.id]: {
        sessionId: session.id,
        alive: true,
        agent: null,
        status: 'idle',
        program: 'node',
      },
    }
    await flushPromises()
    expect(wrapper.find('[data-test=launch-cmd]').attributes('title')).toBe(
      '当前在 node 里，退出后再用',
    )

    // 回到提示符：按钮恢复，tooltip 回到命令本身
    agent.runtime = {
      [session.id]: { sessionId: session.id, alive: true, agent: null, status: 'idle' },
    }
    await flushPromises()
    expect(wrapper.find('[data-test=launch-cmd]').attributes('aria-disabled')).toBeUndefined()
    expect(wrapper.find('[data-test=launch-cmd]').attributes('title')).toBe('claude')
    await wrapper.find('[data-test=launch-cmd]').trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'claude\r')
  })
})
