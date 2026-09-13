import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditSessionModal from '../../../src/renderer/src/components/EditSessionModal.vue'
import { installFakeApi, makeSession } from '../fakeApi'
import { installFakeWorkspace } from '../fakeWorkspace'

describe('EditSessionModal', () => {
  const session = makeSession({
    name: 'simba-api',
    cwd: 'D:\\Projects\\simba\\api',
    shell: 'cmd.exe',
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('预填名称 / 目录 / Shell 并显示重启提示；没有改动时「保存」直接关闭、不调 SDK', async () => {
    const api = installFakeApi({ app: { listShells: async () => ['cmd.exe', 'powershell.exe'] } })
    installFakeWorkspace([session])
    const wrapper = mount(EditSessionModal, { props: { session } })
    await flushPromises()

    expect((wrapper.find('[data-test=es-name]').element as HTMLInputElement).value).toBe(
      'simba-api',
    )
    expect((wrapper.find('[data-test=es-path]').element as HTMLInputElement).value).toBe(
      'D:\\Projects\\simba\\api',
    )
    expect((wrapper.find('[data-test=es-shell]').element as HTMLSelectElement).value).toBe(
      'cmd.exe',
    )
    expect(wrapper.findAll('[data-test=es-shell] option').map((o) => o.text())).toEqual([
      'cmd.exe',
      'powershell.exe',
    ])
    expect(wrapper.find('[data-test=es-hint]').text()).toBe('更改目录或 Shell 会重启这个会话的终端')

    await wrapper.find('[data-test=es-save]').trigger('click')
    await flushPromises()
    expect(api.session.update).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('只提交变了的字段；终端从未打开时保存后不选中；目录清空 → 占位「需要一个目录」并聚焦、不提交', async () => {
    const api = installFakeApi()
    const { workspace } = installFakeWorkspace([session])
    const wrapper = mount(EditSessionModal, { props: { session }, attachTo: document.body })
    await flushPromises()

    await wrapper.find('[data-test=es-name]').setValue('renamed')
    await wrapper.find('[data-test=es-save]').trigger('click')
    await flushPromises()
    expect(api.session.update).toHaveBeenCalledWith(session.id, { name: 'renamed' })
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(workspace.activeId).toBeNull()

    vi.mocked(api.session.update).mockClear()
    const path = wrapper.find('[data-test=es-path]')
    await path.setValue('   ')
    await wrapper.find('[data-test=es-save]').trigger('click')
    await flushPromises()
    expect(api.session.update).not.toHaveBeenCalled()
    expect(path.attributes('placeholder')).toBe('需要一个目录')
    expect(document.activeElement).toBe(path.element)
    wrapper.unmount()
  })

  it('「浏览…」填目录；终端已打开（已退出）时保存成功后重新选中 = 按新配置重启', async () => {
    const api = installFakeApi({ session: { pickDirectory: async () => 'E:\\new\\dir' } })
    const { workspace, pty } = installFakeWorkspace([session])
    await workspace.select(session.id)
    pty.emitExit(session.id, 0)
    expect(workspace.phaseOf(session.id)).toBe('exited')
    expect(pty.opens).toHaveLength(1)

    const wrapper = mount(EditSessionModal, { props: { session } })
    await flushPromises()
    await wrapper.find('[data-test=es-browse]').trigger('click')
    await flushPromises()
    expect((wrapper.find('[data-test=es-path]').element as HTMLInputElement).value).toBe(
      'E:\\new\\dir',
    )

    await wrapper.find('[data-test=es-save]').trigger('click')
    await flushPromises()
    expect(api.session.update).toHaveBeenCalledWith(session.id, { cwd: 'E:\\new\\dir' })
    expect(pty.opens).toHaveLength(2)
    expect(workspace.phaseOf(session.id)).toBe('running')
    expect(workspace.activeId).toBe(session.id)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('SDK 拒绝 → 红字显示、弹窗保持；Esc / 「取消」/ 点遮罩都发出 close', async () => {
    installFakeApi({
      session: {
        update: vi.fn(async () => {
          throw new Error('终端里有程序正在运行，退出后再修改目录或 Shell')
        }),
      },
    })
    installFakeWorkspace([session])
    const wrapper = mount(EditSessionModal, { props: { session }, attachTo: document.body })
    await flushPromises()

    await wrapper.find('[data-test=es-shell]').setValue('powershell.exe')
    await wrapper.find('[data-test=es-save]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test=es-error]').text()).toBe(
      '终端里有程序正在运行，退出后再修改目录或 Shell',
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.find('[data-test=es-cancel]').trigger('click')
    await wrapper.find('[data-test=edit-session-modal]').trigger('mousedown')
    expect(wrapper.emitted('close')).toHaveLength(3)
    wrapper.unmount()
  })
})
