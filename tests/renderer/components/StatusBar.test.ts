import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StatusBar from '../../../src/renderer/src/components/StatusBar.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
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
})
