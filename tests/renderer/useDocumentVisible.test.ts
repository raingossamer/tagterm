import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, type Ref } from 'vue'
import { useDocumentVisible } from '../../src/renderer/src/composables/useDocumentVisible'

/** 页面可见性（藏到托盘 / 最小化即不可见）的响应式镜像：App 据此在窗口看不见时释放 WebGL */
describe('useDocumentVisible（页面可见性镜像）', () => {
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  afterEach(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  function mountHost(): { wrapper: ReturnType<typeof mount>; visible: Ref<boolean> } {
    let visible!: Ref<boolean>
    const Host = defineComponent({
      setup() {
        visible = useDocumentVisible()
        return () => h('div')
      },
    })
    return { wrapper: mount(Host), visible }
  }

  it('挂载时读当前可见性；隐藏 / 显示各更新一次；卸载后不再跟随', () => {
    const { wrapper, visible } = mountHost()
    expect(visible.value).toBe(true)

    setHidden(true)
    expect(visible.value).toBe(false)
    setHidden(false)
    expect(visible.value).toBe(true)

    wrapper.unmount()
    setHidden(true)
    expect(visible.value).toBe(true)
  })

  it('页面一开始就不可见（开机自启藏在托盘时挂载）→ 初值为不可见', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    const { wrapper, visible } = mountHost()
    expect(visible.value).toBe(false)
    wrapper.unmount()
  })
})
