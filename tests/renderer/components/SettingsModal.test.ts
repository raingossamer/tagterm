import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsModal from '../../../src/renderer/src/components/SettingsModal.vue'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { installFakeApi, makeSettings } from '../fakeApi'

describe('SettingsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('「关于」显示版本与数据目录；「终端背景」未设置时提示纯色；「选择图片…」后以当前遮罩保存', async () => {
    const api = installFakeApi({
      app: { getVersion: async () => '0.1.0', pickImage: vi.fn(async () => 'D:/wall.png') },
    })
    const wrapper = mount(SettingsModal)
    await flushPromises()

    expect(wrapper.find('[data-test=about-version]').text()).toBe('TagTerm v0.1.0')
    expect(wrapper.find('[data-test=about-data-dir]').text()).toBe(
      'C:/Users/test/AppData/Roaming/TagTerm',
    )
    expect(wrapper.find('[data-test=bg-path]').text()).toBe('未设置（纯色）')
    expect(wrapper.find('[data-test=bg-missing]').exists()).toBe(false)

    await wrapper.find('[data-test=bg-pick]').trigger('click')
    await flushPromises()
    expect(api.settings.update).toHaveBeenCalledWith({
      terminalBackground: { imagePath: 'D:/wall.png', dimOpacity: 0.6 },
    })
  })

  it('已设置图片：显示路径；文件不存在时提示；滑块拖动即时预览、松手保存；「清除」回到纯色', async () => {
    const api = installFakeApi({ app: { pickImage: vi.fn(async () => null) } })
    const settings = useSettingsStore()
    settings.settings = makeSettings({
      terminalBackground: { imagePath: 'D:/wall.png', dimOpacity: 0.6 },
    })
    settings.backgroundImage = null
    const wrapper = mount(SettingsModal)
    await flushPromises()

    expect(wrapper.find('[data-test=bg-path]').text()).toBe('D:/wall.png')
    expect(wrapper.find('[data-test=bg-missing]').text()).toBe('图片文件不存在，已回退为纯色')

    await wrapper.find('[data-test=bg-pick]').trigger('click') // 取消对话框 → 不保存
    await flushPromises()
    expect(api.settings.update).not.toHaveBeenCalled()

    // 不用 setValue：它会同时触发 input 与 change，这里要分别验证「拖动只预览」「松手才保存」
    const slider = wrapper.find('[data-test=bg-dim]')
    expect((slider.element as HTMLInputElement).value).toBe('60')
    ;(slider.element as HTMLInputElement).value = '25'
    await slider.trigger('input')
    expect(settings.terminalBackground.dimOpacity).toBe(0.25)
    expect(wrapper.find('[data-test=bg-dim-value]').text()).toBe('25%')
    expect(api.settings.update).not.toHaveBeenCalled()
    await slider.trigger('change')
    await flushPromises()
    expect(api.settings.update).toHaveBeenCalledWith({
      terminalBackground: { imagePath: 'D:/wall.png', dimOpacity: 0.25 },
    })

    await wrapper.find('[data-test=bg-clear]').trigger('click')
    await flushPromises()
    expect(api.settings.update).toHaveBeenLastCalledWith({
      terminalBackground: { imagePath: null, dimOpacity: 0.6 },
    })
  })

  it('「更新」段先显示占位；「完成」与 Esc 关闭', async () => {
    installFakeApi()
    const wrapper = mount(SettingsModal, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.find('[data-test=update-check]').text()).toBe('检查更新')
    expect(wrapper.find('[data-test=update-status]').text()).toBe('即将支持')

    await wrapper.find('[data-test=settings-done]').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
})
