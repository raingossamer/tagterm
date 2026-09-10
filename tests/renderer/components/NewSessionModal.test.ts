import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NewSessionModal from '../../../src/renderer/src/components/NewSessionModal.vue'
import { installFakeApi, makeSession } from '../fakeApi'

describe('NewSessionModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('目录为空时不创建：占位改为「需要一个目录」并聚焦目录框', async () => {
    const api = installFakeApi()
    const wrapper = mount(NewSessionModal, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('[data-test=ns-create]').trigger('click')

    const path = wrapper.find('[data-test=ns-path]')
    expect(path.attributes('placeholder')).toBe('需要一个目录')
    expect(document.activeElement).toBe(path.element)
    expect(api.session.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('名称留空时不传 name（主进程取目录末段）；Enter 提交；创建后发出 created', async () => {
    const created = makeSession({ name: 'api', cwd: 'D:\\Projects\\simba\\api' })
    const api = installFakeApi({ session: { create: vi.fn(async () => created) } })
    const wrapper = mount(NewSessionModal)
    await flushPromises()

    await wrapper.find('[data-test=ns-path]').setValue('D:\\Projects\\simba\\api')
    await wrapper.find('[data-test=ns-path]').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(api.session.create).toHaveBeenCalledWith({
      cwd: 'D:\\Projects\\simba\\api',
      name: undefined,
      shell: 'cmd.exe',
    })
    expect(wrapper.emitted('created')).toEqual([[created]])
  })

  it('「浏览…」把系统对话框选中的目录填入；Shell 下拉只列可用 shell', async () => {
    installFakeApi({
      app: { listShells: async () => ['cmd.exe', 'powershell.exe'] },
      session: { pickDirectory: async () => 'E:\\picked\\dir' },
    })
    const wrapper = mount(NewSessionModal)
    await flushPromises()

    await wrapper.find('[data-test=ns-browse]').trigger('click')
    await flushPromises()
    expect((wrapper.find('[data-test=ns-path]').element as HTMLInputElement).value).toBe(
      'E:\\picked\\dir',
    )

    const options = wrapper.findAll('[data-test=ns-shell] option').map((o) => o.text())
    expect(options).toEqual(['cmd.exe', 'powershell.exe'])
  })

  it('取消按钮发出 close', async () => {
    installFakeApi()
    const wrapper = mount(NewSessionModal)
    await wrapper.find('[data-test=ns-cancel]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
