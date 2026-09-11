import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NewSessionModal from '../../../src/renderer/src/components/NewSessionModal.vue'
import { useFilterStore } from '../../../src/renderer/src/stores/filter'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { installFakeApi, makeSession, makeTag } from '../fakeApi'

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

  it('标签 chips：打开时预选当前筛选选中的标签；点击切换；提交时把选中标签作为 tagIds 发送', async () => {
    const java = makeTag({ name: 'java', color: '#C98A0C', sortOrder: 2 })
    const simba = makeTag({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })
    useTagsStore().tags = [java, simba]
    useFilterStore().toggle(java.id)
    const api = installFakeApi()
    const wrapper = mount(NewSessionModal)
    await flushPromises()

    expect(wrapper.text()).toContain('标签（可多选）')
    const chips = wrapper.findAll('[data-test=ns-chip]')
    expect(chips.map((c) => c.text())).toEqual(['simba', 'java'])
    expect(chips.map((c) => c.classes().includes('on'))).toEqual([false, true])
    expect(chips[0]!.attributes('style')).toContain('#2F6FDB')

    await chips[0]!.trigger('click')
    await chips[1]!.trigger('click')
    expect(chips.map((c) => c.classes().includes('on'))).toEqual([true, false])

    await wrapper.find('[data-test=ns-path]').setValue('C:/work/api')
    await wrapper.find('[data-test=ns-create]').trigger('click')
    await flushPromises()
    expect(api.session.create).toHaveBeenCalledWith({
      cwd: 'C:/work/api',
      name: undefined,
      shell: 'cmd.exe',
      tagIds: [simba.id],
    })
  })

  it('「新标签名，回车添加」：回车立即 tag.create 并选中该 chip、输入框清空；此输入框内的 Enter 不触发创建会话；无标签时提示「还没有标签」', async () => {
    const created = makeTag({ name: 'iot' })
    const api = installFakeApi({ tag: { create: vi.fn(async () => created) } })
    const wrapper = mount(NewSessionModal)
    await flushPromises()
    expect(wrapper.find('[data-test=ns-tags-hint]').text()).toBe('还没有标签')

    const input = wrapper.find<HTMLInputElement>('[data-test=ns-new-tag]')
    expect(input.attributes('placeholder')).toBe('新标签名，回车添加')
    await input.setValue(' iot ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.tag.create).toHaveBeenCalledWith(' iot ', undefined)
    expect(api.session.create).not.toHaveBeenCalled()
    expect(input.element.value).toBe('')

    // 主进程广播后 chip 出现且已选中
    useTagsStore().tags = [created]
    await flushPromises()
    const chips = wrapper.findAll('[data-test=ns-chip]')
    expect(chips.map((c) => c.text())).toEqual(['iot'])
    expect(chips[0]!.classes()).toContain('on')
  })

  it('attach 失败（SDK reject）时错误内联显示、弹窗不关闭、不发出 created', async () => {
    const api = installFakeApi({
      session: { create: vi.fn(async () => Promise.reject(new Error('标签不存在：ghost'))) },
    })
    const wrapper = mount(NewSessionModal)
    await flushPromises()
    await wrapper.find('[data-test=ns-path]').setValue('C:/work/api')
    await wrapper.find('[data-test=ns-create]').trigger('click')
    await flushPromises()
    expect(api.session.create).toHaveBeenCalled()
    expect(wrapper.find('[data-test=ns-error]').text()).toBe('标签不存在：ghost')
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
