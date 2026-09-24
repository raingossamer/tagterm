import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ConfirmDialog from '../../../src/renderer/src/components/ConfirmDialog.vue'
import { useConfirmStore } from '../../../src/renderer/src/stores/confirm'

function press(key: string): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
}

describe('ConfirmDialog', () => {
  let wrapper: VueWrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    wrapper = mount(ConfirmDialog, { attachTo: document.body })
  })
  afterEach(() => {
    wrapper.unmount()
  })

  it('没有请求时不渲染；有请求时显示文案与「取消」「确定」，焦点落在「确定」', async () => {
    expect(wrapper.find('[data-test=confirm-dialog]').exists()).toBe(false)
    void useConfirmStore().ask('删除标签 "java"？会话本身会保留。', { danger: true })
    await flushPromises()

    expect(wrapper.find('[data-test=confirm-message]').text()).toBe(
      '删除标签 "java"？会话本身会保留。',
    )
    expect(wrapper.find('[data-test=confirm-cancel]').text()).toBe('取消')
    const ok = wrapper.find('[data-test=confirm-ok]')
    expect(ok.text()).toBe('确定')
    expect(ok.classes()).toContain('danger')
    expect(document.activeElement).toBe(ok.element)
  })

  it('点「确定」为是、点「取消」为否，作答后弹窗消失', async () => {
    const confirm = useConfirmStore()
    const yes = confirm.ask('继续？')
    await flushPromises()
    await wrapper.find('[data-test=confirm-ok]').trigger('click')
    await expect(yes).resolves.toBe(true)
    expect(wrapper.find('[data-test=confirm-dialog]').exists()).toBe(false)

    const no = confirm.ask('继续？')
    await flushPromises()
    await wrapper.find('[data-test=confirm-cancel]').trigger('click')
    await expect(no).resolves.toBe(false)
  })

  it('Enter 按焦点所在的按钮作答（缺省在「确定」）；Tab 在两个按钮之间切换', async () => {
    const confirm = useConfirmStore()
    const yes = confirm.ask('继续？')
    await flushPromises()
    press('Enter')
    await expect(yes).resolves.toBe(true)

    const no = confirm.ask('继续？')
    await flushPromises()
    press('Tab')
    expect(document.activeElement).toBe(wrapper.find('[data-test=confirm-cancel]').element)
    press('Tab')
    expect(document.activeElement).toBe(wrapper.find('[data-test=confirm-ok]').element)
    press('Tab')
    press('Enter')
    await expect(no).resolves.toBe(false)
  })

  it('Esc 为否，且只关这一层：压在别的弹窗上时，那个弹窗在 document 上的 Esc 监听收不到', async () => {
    const underlying = vi.fn()
    document.addEventListener('keydown', underlying)
    try {
      const no = useConfirmStore().ask('继续？')
      await flushPromises()
      press('Escape')
      await expect(no).resolves.toBe(false)
      expect(underlying).not.toHaveBeenCalled()

      press('Escape') // 弹窗已关：Esc 照常交给底下的弹窗
      expect(underlying).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', underlying)
    }
  })

  it('点遮罩为否；点弹窗本身不作答', async () => {
    const no = useConfirmStore().ask('继续？')
    await flushPromises()
    await wrapper.find('[data-test=confirm-message]').trigger('mousedown')
    expect(wrapper.find('[data-test=confirm-dialog]').exists()).toBe(true)
    await wrapper.find('[data-test=confirm-dialog]').trigger('mousedown')
    await expect(no).resolves.toBe(false)
  })

  it('关掉后焦点回到打开前的元素（它还在页面上时）', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const no = useConfirmStore().ask('继续？')
    await flushPromises()
    expect(document.activeElement).not.toBe(input)
    press('Escape')
    await no
    expect(document.activeElement).toBe(input)
  })
})
