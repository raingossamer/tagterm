import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StatusBar from '../../../src/renderer/src/components/StatusBar.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useAgentStore } from '../../../src/renderer/src/stores/agent'
import { installFakeApi, makeSession } from '../fakeApi'

describe('StatusBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('显示主进程返回的应用版本号', async () => {
    installFakeApi({ app: { getVersion: async () => '0.1.0' } })

    const wrapper = mount(StatusBar)
    await flushPromises()

    expect(wrapper.find('[data-test=status-version]').text()).toContain('0.1.0')
  })

  it('显示会话数量，随列表变化', async () => {
    installFakeApi()
    const sessions = useSessionsStore()
    sessions.sessions = [makeSession(), makeSession()]

    const wrapper = mount(StatusBar)
    expect(wrapper.find('[data-test=status-sessions]').text()).toBe('2 个会话')

    sessions.sessions = [makeSession()]
    await flushPromises()
    expect(wrapper.find('[data-test=status-sessions]').text()).toBe('1 个会话')
  })

  it('三项状态计数取 agent store 的 countBy，随记录变化', async () => {
    installFakeApi()
    const agent = useAgentStore()
    const wrapper = mount(StatusBar)
    expect(wrapper.find('[data-test=status-working]').text()).toBe('0 运行中')
    expect(wrapper.find('[data-test=status-blocked]').text()).toBe('0 等待你')
    expect(wrapper.find('[data-test=status-done]').text()).toBe('0 已完成未查看')

    agent.runtime = {
      a: { sessionId: 'a', alive: true, agent: 'claude', status: 'working' },
      b: { sessionId: 'b', alive: true, agent: 'codex', status: 'blocked' },
      c: { sessionId: 'c', alive: true, agent: 'pi', status: 'blocked' },
      d: { sessionId: 'd', alive: true, agent: null, status: 'done' },
    }
    await flushPromises()
    expect(wrapper.find('[data-test=status-working]').text()).toBe('1 运行中')
    expect(wrapper.find('[data-test=status-blocked]').text()).toBe('2 等待你')
    expect(wrapper.find('[data-test=status-done]').text()).toBe('1 已完成未查看')
  })
})
