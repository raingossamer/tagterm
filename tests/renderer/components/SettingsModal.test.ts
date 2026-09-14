import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_BACKGROUND } from '@shared/models'
import SettingsModal from '../../../src/renderer/src/components/SettingsModal.vue'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { useUpdateStore } from '../../../src/renderer/src/stores/update'
import { installFakeApi, makeSettings } from '../fakeApi'

describe('SettingsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  /** 让 store 处于「已保存一张背景图」的状态 */
  async function withSavedImage() {
    const store = useSettingsStore()
    store.settings = makeSettings({
      background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/wall/雪山.png' },
    })
    store.backgroundImage = 'data:image/png;base64,AAA'
    return store
  }

  it('左侧四段导航：缺省停在「外观」，点击切换内容区', async () => {
    installFakeApi()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    expect(wrapper.findAll('.nav-item').map((n) => n.text())).toEqual([
      '外观',
      '启动',
      '更新',
      '关于',
    ])
    expect(wrapper.find('[data-test=appearance-section]').exists()).toBe(true)

    await wrapper.find('[data-test=settings-nav-startup]').trigger('click')
    expect(wrapper.find('[data-test=appearance-section]').exists()).toBe(false)
    expect(wrapper.find('[data-test=auto-launch-section]').exists()).toBe(true)

    await wrapper.find('[data-test=settings-nav-about]').trigger('click')
    expect(wrapper.find('[data-test=about-version]').exists()).toBe(true)
  })

  it('外观段：无图时滑块置灰；「更换图片」把选中的图进草稿并整窗预览，但不落盘', async () => {
    const api = installFakeApi({
      app: { pickImage: vi.fn(async () => 'D:/wall/雪山.png') },
      settings: { readBackgroundImage: vi.fn(async () => 'data:image/png;base64,AAA') },
    })
    const store = useSettingsStore()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    expect(wrapper.find('[data-test=bg-name]').text()).toBe('未设置背景')
    expect(
      (wrapper.find('[data-test=bg-image-opacity]').element as HTMLInputElement).disabled,
    ).toBe(true)

    await wrapper.find('[data-test=bg-pick]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=bg-name]').text()).toBe('雪山.png')
    expect(store.background.imagePath).toBe('D:/wall/雪山.png') // 预览：整窗立刻生效
    expect(store.backgroundImage).toBe('data:image/png;base64,AAA')
    expect(api.settings.update).not.toHaveBeenCalled() // 但没落盘
    expect(
      (wrapper.find('[data-test=bg-image-opacity]').element as HTMLInputElement).disabled,
    ).toBe(false)
  })

  it('三个滑块与显示方式改动只进草稿并实时预览；「保存设置」一次提交并关闭', async () => {
    const api = installFakeApi()
    const store = await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    await wrapper.find('[data-test=bg-fit]').setValue('cover')
    await wrapper.find('[data-test=bg-image-opacity]').setValue('20')
    await wrapper.find('[data-test=bg-panel-opacity]').setValue('90')
    await wrapper.find('[data-test=bg-blur]').setValue('12')
    await flushPromises()

    expect(wrapper.find('[data-test=bg-image-opacity-value]').text()).toBe('20%')
    expect(wrapper.find('[data-test=bg-panel-opacity-value]').text()).toBe('90%')
    expect(wrapper.find('[data-test=bg-blur-value]').text()).toBe('12 px')
    expect(store.background).toMatchObject({
      fit: 'cover',
      imageOpacity: 0.2,
      panelOpacity: 0.9,
      blurPx: 12,
    })
    expect(api.settings.update).not.toHaveBeenCalled()

    await wrapper.find('[data-test=settings-save]').trigger('click')
    await flushPromises()
    expect(api.settings.update).toHaveBeenCalledWith({
      background: {
        imagePath: 'D:/wall/雪山.png',
        fit: 'cover',
        imageOpacity: 0.2,
        panelOpacity: 0.9,
        blurPx: 12,
      },
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('显示方式的说明随选项变化', async () => {
    installFakeApi()
    await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()
    const hint = () => wrapper.find('[data-test=bg-fit-hint]').text()

    expect(hint()).toBe('保留整张图片，空白区域使用主题底色')
    await wrapper.find('[data-test=bg-fit]').setValue('cover')
    expect(hint()).toBe('等比放大铺满窗口，超出的部分裁掉')
    await wrapper.find('[data-test=bg-fit]').setValue('tile')
    expect(hint()).toBe('按原始尺寸重复铺满窗口')
  })

  it('「取消」与 Esc 丢弃草稿：整窗还原为已保存值，不调 SDK', async () => {
    const api = installFakeApi()
    const store = await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    await wrapper.find('[data-test=bg-blur]').setValue('18')
    await flushPromises()
    expect(store.background.blurPx).toBe(18)

    await wrapper.find('[data-test=settings-cancel]').trigger('click')
    await flushPromises()
    expect(store.background).toEqual({ ...DEFAULT_BACKGROUND, imagePath: 'D:/wall/雪山.png' })
    expect(api.settings.update).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)

    const second = mount(SettingsModal)
    await flushPromises()
    await second.find('[data-test=bg-blur]').setValue('18')
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(store.background.blurPx).toBe(DEFAULT_BACKGROUND.blurPx)
    expect(second.emitted('close')).toHaveLength(1)
  })

  it('关掉「实时预览」后整窗回到已保存值，弹窗内缩略图仍看草稿', async () => {
    installFakeApi({
      settings: { readBackgroundImage: vi.fn(async () => 'data:image/png;base64,DRAFT') },
    })
    const store = await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    await wrapper.find('[data-test=bg-blur]').setValue('16')
    await flushPromises()
    expect(store.background.blurPx).toBe(16)

    await wrapper.find('[data-test=live-preview]').setValue(false)
    await flushPromises()
    expect(store.background.blurPx).toBe(DEFAULT_BACKGROUND.blurPx) // 整窗回到已保存值
    expect(wrapper.find('[data-test=bg-thumb] img').attributes('src')).toBe(
      'data:image/png;base64,DRAFT',
    )
  })

  it('「启动」段：复选框反映登录项状态并标注即时生效；改动即 setAutoLaunch 并按返回回填；失败红字并还原', async () => {
    const api = installFakeApi({
      app: {
        getAutoLaunch: vi.fn(async () => ({ enabled: true, blockedBySystem: true })),
        setAutoLaunch: vi.fn(async (enabled: boolean) => ({ enabled, blockedBySystem: false })),
      },
    })
    const wrapper = mount(SettingsModal)
    await flushPromises()
    await wrapper.find('[data-test=settings-nav-startup]').trigger('click')
    const box = () => wrapper.find('[data-test=auto-launch]').element as HTMLInputElement

    expect(wrapper.find('[data-test=auto-launch-label]').text()).toBe('开机时自动启动 TagTerm')
    expect(wrapper.find('[data-test=auto-launch-instant]').text()).toContain('即时生效')
    expect(box().checked).toBe(true)
    expect(wrapper.find('[data-test=auto-launch-blocked]').text()).toBe(
      '已在系统「启动应用」中被禁用',
    )

    await wrapper.find('[data-test=auto-launch]').setValue(false)
    await flushPromises()
    expect(api.app.setAutoLaunch).toHaveBeenCalledWith(false)
    expect(box().checked).toBe(false)
    expect(wrapper.find('[data-test=auto-launch-blocked]').exists()).toBe(false)

    vi.mocked(api.app.setAutoLaunch).mockRejectedValueOnce(new Error('开发模式下不能设置开机自启'))
    await wrapper.find('[data-test=auto-launch]').setValue(true)
    await flushPromises()
    expect(box().checked).toBe(false)
    expect(wrapper.find('[data-test=settings-error]').text()).toBe('开发模式下不能设置开机自启')
  })

  it('「更新」段：检查更新 → 状态文案；有新版本出现「下载」；下载完成出现「立即安装并重启」', async () => {
    const api = installFakeApi()
    const update = useUpdateStore()
    const wrapper = mount(SettingsModal)
    await flushPromises()
    await wrapper.find('[data-test=settings-nav-update]').trigger('click')

    expect(wrapper.find('[data-test=update-status]').text()).toBe('') // idle 无文案
    await wrapper.find('[data-test=update-check]').trigger('click')
    expect(api.update.check).toHaveBeenCalled()

    update.status = { state: 'available', version: '0.3.0' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test=update-status]').text()).toBe('发现新版本 v0.3.0')
    await wrapper.find('[data-test=update-download]').trigger('click')
    expect(api.update.download).toHaveBeenCalled()

    update.status = { state: 'downloaded', version: '0.3.0' }
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test=update-install]').trigger('click')
    expect(api.update.install).toHaveBeenCalled()
  })

  it('「关于」显示版本与数据目录', async () => {
    installFakeApi({ app: { getVersion: async () => '0.1.0' } })
    const wrapper = mount(SettingsModal)
    await flushPromises()
    await wrapper.find('[data-test=settings-nav-about]').trigger('click')

    expect(wrapper.find('[data-test=about-version]').text()).toBe('TagTerm v0.1.0')
    expect(wrapper.find('[data-test=about-data-dir]').text()).toBe(
      'C:/Users/test/AppData/Roaming/TagTerm',
    )
  })
})
