import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsModal from '../../../src/renderer/src/components/SettingsModal.vue'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { useUpdateStore } from '../../../src/renderer/src/stores/update'
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

  it('「更新」段：检查更新 → 状态文案；有新版本出现「下载」；下载完成出现「立即安装并重启」', async () => {
    const api = installFakeApi()
    const update = useUpdateStore()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    const check = wrapper.find('[data-test=update-check]')
    expect(check.text()).toBe('检查更新')
    expect(wrapper.find('[data-test=update-status]').text()).toBe('')
    await check.trigger('click')
    expect(api.update.check).toHaveBeenCalledTimes(1)

    update.status = { state: 'checking' }
    await flushPromises()
    expect(wrapper.find('[data-test=update-status]').text()).toBe('正在检查…')
    expect(check.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test=update-download]').exists()).toBe(false)

    update.status = { state: 'available', version: '0.2.0' }
    await flushPromises()
    expect(wrapper.find('[data-test=update-status]').text()).toBe('发现新版本 v0.2.0')
    await wrapper.find('[data-test=update-download]').trigger('click')
    expect(api.update.download).toHaveBeenCalledTimes(1)

    update.status = { state: 'downloading', version: '0.2.0', percent: 42 }
    await flushPromises()
    expect(wrapper.find('[data-test=update-status]').text()).toBe('正在下载 v0.2.0：42%')
    expect(wrapper.find('[data-test=update-download]').exists()).toBe(false)

    update.status = { state: 'downloaded', version: '0.2.0' }
    await flushPromises()
    await wrapper.find('[data-test=update-install]').trigger('click')
    expect(api.update.install).toHaveBeenCalledTimes(1)

    update.status = { state: 'error', message: '连不上' }
    await flushPromises()
    expect(wrapper.find('[data-test=update-status]').text()).toBe('检查更新失败：连不上')
    expect(check.attributes('disabled')).toBeUndefined()
  })

  it('「完成」与 Esc 关闭', async () => {
    installFakeApi()
    const wrapper = mount(SettingsModal, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('[data-test=settings-done]').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
})
