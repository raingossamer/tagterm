import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_BACKGROUND } from '@shared/models'
import AppBackground from '../../../src/renderer/src/components/AppBackground.vue'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { installFakeApi, makeSettings } from '../fakeApi'

describe('AppBackground', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    installFakeApi()
  })

  function withBackground(partial: Partial<typeof DEFAULT_BACKGROUND>) {
    const store = useSettingsStore()
    store.settings = makeSettings({
      background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/wall.png', ...partial },
    })
    store.backgroundImage = 'data:image/png;base64,AAA'
    return store
  }

  it('没有背景图时整层不渲染', () => {
    useSettingsStore().settings = makeSettings()
    expect(mount(AppBackground).find('[data-test=app-background]').exists()).toBe(false)
  })

  it('有背景图时铺满窗口：按 fit 决定 background-size、模糊与不透明度来自设置', () => {
    withBackground({ fit: 'cover', imageOpacity: 0.35, blurPx: 4 })
    const style = mount(AppBackground).find('[data-test=app-background]').attributes('style')!

    expect(style).toContain('data:image/png;base64,AAA')
    expect(style).toContain('background-size: cover')
    expect(style).toContain('background-repeat: no-repeat')
    expect(style).toContain('opacity: 0.35')
    expect(style).toContain('blur(4px)')
  })

  it('平铺用 repeat + 原尺寸；模糊为 0 时不加 filter 也不放大', () => {
    withBackground({ fit: 'tile', blurPx: 0 })
    const style = mount(AppBackground).find('[data-test=app-background]').attributes('style')!

    expect(style).toContain('background-repeat: repeat')
    expect(style).toContain('background-size: auto')
    expect(style).toContain('filter: none')
    expect(style).toContain('transform: none')
  })
})
