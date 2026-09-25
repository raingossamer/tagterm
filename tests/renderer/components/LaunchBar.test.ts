import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LaunchBar from '../../../src/renderer/src/components/LaunchBar.vue'
import { useAgentStore } from '../../../src/renderer/src/stores/agent'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
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

  it('唤起区平铺 pinned 命令（显示名），点击即向终端写入 `<command>\r` 并把焦点交回终端；清屏按 shell 写 cls / clear', async () => {
    const api = installFakeApi()
    useSettingsStore().settings = makeSettings({
      launchCommands: [
        makeCommand({ command: 'pi', sortOrder: 2 }),
        makeCommand({ command: 'claude --continue', label: 'claude 续', sortOrder: 1 }),
      ],
    })
    const focusActive = vi.spyOn(useWorkspaceStore(), 'focusActive')
    const wrapper = mount(LaunchBar, { props: { session } })
    await flushPromises()

    const launchers = wrapper.findAll('[data-test=launch-cmd]')
    expect(launchers.map((b) => b.text())).toEqual(['claude 续', 'pi'])
    expect(wrapper.find('[data-test=launch-label]').text()).toBe('唤起')
    expect(wrapper.find('[data-test=launch-more]').exists()).toBe(false)

    await launchers[0]!.trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'claude --continue\r')
    // 唤起的工具接着要在终端里选会话、按回车：写完命令焦点直接落到终端，不用再点一下终端
    expect(focusActive).toHaveBeenCalledTimes(1)

    await wrapper.find('[data-test=strip-clear]').trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'cls\r')
    expect(focusActive).toHaveBeenCalledTimes(2)

    await wrapper.setProps({ session: { ...session, shell: 'powershell.exe' } })
    await wrapper.find('[data-test=strip-clear]').trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'clear\r')
    expect(focusActive).toHaveBeenCalledTimes(3)
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
    const focusActive = vi.spyOn(useWorkspaceStore(), 'focusActive')
    await items[0]!.trigger('click')
    expect(api.pty.write).toHaveBeenCalledWith(session.id, 'pi --model x\r')
    expect(wrapper.find('[data-test=launch-more-item]').exists()).toBe(false)
    expect(focusActive).toHaveBeenCalledTimes(1) // 「更多」里点选同样把焦点交回终端

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
    const focusActive = vi.spyOn(useWorkspaceStore(), 'focusActive')
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
    expect(focusActive).not.toHaveBeenCalled() // 什么都没发生，焦点也不动
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

  describe('在路径条上直接拖动唤起按钮（像浏览器收藏夹栏）', () => {
    /** 路径条上：常用 a b 平铺，「更多」里 c */
    function setup(commands = ['a', 'b', '-c']): ReturnType<typeof installFakeApi> {
      const api = installFakeApi()
      useSettingsStore().settings = makeSettings({
        launchCommands: commands.map((name, i) =>
          makeCommand({
            command: name.replace('-', ''),
            pinned: !name.startsWith('-'),
            sortOrder: i + 1,
          }),
        ),
      })
      return api
    }
    /** 保存出去的列表写成「常用 | 更多」两段 */
    function saved(api: ReturnType<typeof installFakeApi>): string {
      const rows = vi.mocked(api.settings.update).mock.calls.at(-1)![0].launchCommands!
      const part = (pinned: boolean): string =>
        rows
          .filter((r) => r.pinned === pinned)
          .map((r) => r.command)
          .join(' ')
      return `${part(true)} | ${part(false)}`
    }

    it('平铺按钮可拖（置灰的也可以）；拖到另一个按钮右半边出现落点标记，松手按新顺序保存（常用在前、排序号 1..n）', async () => {
      const api = setup()
      useAgentStore().runtime = {
        [session.id]: {
          sessionId: session.id,
          alive: true,
          agent: null,
          status: 'idle',
          program: 'node',
        },
      }
      const wrapper = mount(LaunchBar, { props: { session } })
      const [a, b] = wrapper.findAll('[data-test=launch-cmd]')
      expect(a!.attributes('draggable')).toBe('true')

      await a!.trigger('dragstart')
      await b!.trigger('dragover', { clientX: 5 }) // happy-dom 的按钮宽 0：x > 中线 = 右半边
      expect(b!.attributes('data-drop')).toBe('after')
      await b!.trigger('drop')
      await flushPromises()
      expect(saved(api)).toBe('b a | c')
      const rows = vi.mocked(api.settings.update).mock.calls[0]![0].launchCommands!
      expect(rows.map((r) => r.sortOrder)).toEqual([1, 2, 3])
      expect(api.pty.write).not.toHaveBeenCalled()
    })

    it('拖到「更多 ▾」上：按钮高亮，停半秒自动展开；松在列表项上插到那里，松在「更多 ▾」按钮上放到末尾', async () => {
      vi.useFakeTimers()
      const api = setup(['a', 'b', '-c', '-d'])
      const wrapper = mount(LaunchBar, { props: { session }, attachTo: document.body })
      const more = wrapper.find('[data-test=launch-more]')

      await wrapper.findAll('[data-test=launch-cmd]')[0]!.trigger('dragstart')
      await more.trigger('dragenter')
      await more.trigger('dragover')
      expect(more.attributes('data-drop')).toBe('into')
      expect(wrapper.find('[data-test=launch-more-pop]').exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(500)
      expect(wrapper.find('[data-test=launch-more-pop]').exists()).toBe(true)

      const items = wrapper.findAll('[data-test=launch-more-item]')
      await items[1]!.trigger('dragover', { clientY: 0 }) // 上半边 = 插在它前面
      expect(items[1]!.attributes('data-drop')).toBe('before')
      await items[1]!.trigger('drop')
      await flushPromises()
      expect(saved(api)).toBe('b | c a d')
      expect(wrapper.find('[data-test=launch-more-pop]').exists()).toBe(false) // 松手后收起

      await wrapper.findAll('[data-test=launch-cmd]')[1]!.trigger('dragstart')
      await more.trigger('dragover')
      await more.trigger('drop')
      await flushPromises()
      expect(saved(api)).toBe('a | c d b')
      wrapper.unmount()
    })

    it('从「更多」里拖回路径条：落到「唤起」小字上 = 最前面的常用按钮', async () => {
      const api = setup()
      const wrapper = mount(LaunchBar, { props: { session } })
      await wrapper.find('[data-test=launch-more]').trigger('click')

      await wrapper.find('[data-test=launch-more-item]').trigger('dragstart')
      await wrapper.find('[data-test=launch-label]').trigger('dragover')
      await wrapper.find('[data-test=launch-label]').trigger('drop')
      await flushPromises()
      expect(saved(api)).toBe('c a b | ')
    })

    it('没有「更多」时，拖动期间临时出现一个「更多 ▾」落点，松手后按是否还有非常用命令决定去留', async () => {
      const api = setup(['a', 'b'])
      const wrapper = mount(LaunchBar, { props: { session } })
      expect(wrapper.find('[data-test=launch-more]').exists()).toBe(false)

      const a = wrapper.findAll('[data-test=launch-cmd]')[0]!
      await a.trigger('dragstart')
      expect(wrapper.find('[data-test=launch-more]').exists()).toBe(true)
      await a.trigger('dragend') // 没放下
      expect(wrapper.find('[data-test=launch-more]').exists()).toBe(false)
      expect(api.settings.update).not.toHaveBeenCalled()

      await a.trigger('dragstart')
      await wrapper.find('[data-test=launch-more]').trigger('dragover')
      await wrapper.find('[data-test=launch-more]').trigger('drop')
      await flushPromises()
      expect(saved(api)).toBe('b | a')
    })

    it('拖出路径条松手：原样弹回、不删除、不保存；松在自己原位也不保存', async () => {
      const api = setup()
      const wrapper = mount(LaunchBar, { props: { session } })
      const [a, b] = wrapper.findAll('[data-test=launch-cmd]')

      await a!.trigger('dragstart')
      await b!.trigger('dragover', { clientX: 5 })
      await b!.trigger('dragleave')
      await a!.trigger('dragend')
      expect(b!.attributes('data-drop')).toBeUndefined()
      expect(api.settings.update).not.toHaveBeenCalled()

      await a!.trigger('dragstart')
      await a!.trigger('dragover')
      await a!.trigger('drop')
      await flushPromises()
      expect(api.settings.update).not.toHaveBeenCalled()
    })

    it('保存失败：把原因上抛给路径条显示（emit error）', async () => {
      const api = setup()
      vi.mocked(api.settings.update).mockRejectedValueOnce(new Error('写入设置失败'))
      const wrapper = mount(LaunchBar, { props: { session } })
      const [a, b] = wrapper.findAll('[data-test=launch-cmd]')

      await a!.trigger('dragstart')
      await b!.trigger('dragover', { clientX: 5 })
      await b!.trigger('drop')
      await flushPromises()
      expect(wrapper.emitted('error')).toEqual([['写入设置失败']])
    })
  })
})
