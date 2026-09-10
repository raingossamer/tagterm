import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import StatusBar from '../../../src/renderer/src/components/StatusBar.vue'
import { installFakeApi } from '../fakeApi'

describe('StatusBar', () => {
  it('显示主进程返回的应用版本号', async () => {
    installFakeApi({ app: { getVersion: async () => '0.1.0' } })

    const wrapper = mount(StatusBar)
    await flushPromises()

    expect(wrapper.find('[data-test=status-version]').text()).toContain('0.1.0')
  })
})
