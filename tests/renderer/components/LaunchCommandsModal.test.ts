import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LaunchCommandsModal from '../../../src/renderer/src/components/LaunchCommandsModal.vue'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { installFakeApi, makeCommand, makeSettings } from '../fakeApi'

const rowsOf = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('[data-test=lc-row]').map((r) => ({
    label: (r.find('[data-test=lc-label]').element as HTMLInputElement).value,
    command: (r.find('[data-test=lc-command]').element as HTMLInputElement).value,
    pinned: (r.find('[data-test=lc-pinned]').element as HTMLInputElement).checked,
  }))

describe('LaunchCommandsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    useSettingsStore().settings = makeSettings({
      launchCommands: [
        makeCommand({ command: 'pi', pinned: false, sortOrder: 2 }),
        makeCommand({ command: 'claude', label: 'Claude', sortOrder: 1 }),
      ],
    })
  })

  it('按 sortOrder 列出全部命令；「新增」追加空行并聚焦命令框；「删除」移除该行', async () => {
    installFakeApi()
    const wrapper = mount(LaunchCommandsModal, { attachTo: document.body })
    expect(rowsOf(wrapper)).toEqual([
      { label: 'Claude', command: 'claude', pinned: true },
      { label: 'pi', command: 'pi', pinned: false },
    ])

    await wrapper.find('[data-test=lc-add]').trigger('click')
    await flushPromises()
    expect(rowsOf(wrapper)).toHaveLength(3)
    expect(rowsOf(wrapper)[2]).toEqual({ label: '', command: '', pinned: true })
    expect(document.activeElement).toBe(wrapper.findAll('[data-test=lc-command]')[2]!.element)

    await wrapper.findAll('[data-test=lc-delete]')[0]!.trigger('click')
    expect(rowsOf(wrapper).map((r) => r.command)).toEqual(['pi', ''])
    wrapper.unmount()
  })

  it('拖拽把一行挪到另一行的位置', async () => {
    installFakeApi()
    const wrapper = mount(LaunchCommandsModal)
    const rows = wrapper.findAll('[data-test=lc-row]')

    await rows[1]!.find('[data-test=lc-handle]').trigger('dragstart')
    await rows[0]!.trigger('dragover')
    await rows[0]!.trigger('drop')

    expect(rowsOf(wrapper).map((r) => r.command)).toEqual(['pi', 'claude'])
  })

  it('「完成」把编辑结果规整后整体提交（新行无 id、位置即顺序、留空命令丢弃）并关闭', async () => {
    const api = installFakeApi()
    const wrapper = mount(LaunchCommandsModal)

    await wrapper.find('[data-test=lc-add]').trigger('click')
    const inputs = wrapper.findAll('[data-test=lc-command]')
    await inputs[2]!.setValue(' pi --model x ')
    await wrapper.findAll('[data-test=lc-label]')[2]!.setValue('pi x')
    await wrapper.findAll('[data-test=lc-pinned]')[2]!.setValue(false)
    await wrapper.findAll('[data-test=lc-pinned]')[1]!.setValue(true)
    await wrapper.find('[data-test=lc-add]').trigger('click') // 留空的行
    await wrapper.find('[data-test=lc-done]').trigger('click')
    await flushPromises()

    expect(api.settings.update).toHaveBeenCalledWith({
      launchCommands: [
        { id: 'c-claude', label: 'Claude', command: 'claude', pinned: true, sortOrder: 1 },
        { id: 'c-pi', label: 'pi', command: 'pi', pinned: true, sortOrder: 2 },
        { label: 'pi x', command: 'pi --model x', pinned: false, sortOrder: 3 },
      ],
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('保存失败时在弹窗内提示、不关闭；Esc 关闭；没有命令时显示提示文案', async () => {
    installFakeApi({ settings: { update: vi.fn(async () => Promise.reject(new Error('磁盘满'))) } })
    const wrapper = mount(LaunchCommandsModal, { attachTo: document.body })

    await wrapper.find('[data-test=lc-done]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test=lc-error]').text()).toContain('磁盘满')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.findAll('[data-test=lc-delete]')[0]!.trigger('click')
    await wrapper.findAll('[data-test=lc-delete]')[0]!.trigger('click')
    expect(wrapper.find('[data-test=lc-empty]').text()).toBe('还没有唤起命令，点「新增」添加')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
