import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SideHead from '../../../src/renderer/src/components/SideHead.vue'
import { useFilterStore } from '../../../src/renderer/src/stores/filter'
import { TERMINAL_WORKSPACE_KEY } from '../../../src/renderer/src/terminal/workspaceKey'
import { makeSession } from '../fakeApi'
import { installFakeWorkspace, type FakeWorkspace } from '../fakeWorkspace'

describe('SideHead（搜索框）', () => {
  const a = makeSession({ name: 'a' })
  let fake: FakeWorkspace
  let wrapper: VueWrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    fake = installFakeWorkspace([a])
    wrapper = mount(SideHead, {
      attachTo: document.body,
      global: { provide: { [TERMINAL_WORKSPACE_KEY as symbol]: fake.core } },
    })
  })
  afterEach(() => {
    wrapper.unmount()
  })

  it('输入即写入 filter.search；占位文案与原型一致', async () => {
    const input = wrapper.find<HTMLInputElement>('[data-test=search-input]')
    expect(input.attributes('placeholder')).toBe('搜索会话名或路径　Ctrl+K')
    await input.setValue('api')
    expect(useFilterStore().search).toBe('api')
  })

  it('搜索框内 Esc 清空搜索词并把焦点交还当前终端', async () => {
    const filter = useFilterStore()
    await fake.workspace.select(a.id)
    const focusBefore = fake.terminals[0]!.focusCount
    const input = wrapper.find<HTMLInputElement>('[data-test=search-input]')
    await input.setValue('api')
    await input.trigger('keydown', { key: 'Escape' })
    expect(filter.search).toBe('')
    expect(input.element.value).toBe('')
    expect(fake.terminals[0]!.focusCount).toBe(focusBefore + 1)
  })

  it('document 上的 Ctrl+K（焦点在别处，如终端）聚焦并全选搜索框，且 preventDefault', async () => {
    const input = wrapper.find<HTMLInputElement>('[data-test=search-input]')
    await input.setValue('abc')
    const other = document.createElement('textarea')
    document.body.appendChild(other)
    other.focus()
    expect(document.activeElement).toBe(other)

    const select = vi.spyOn(input.element, 'select')
    const ev = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    other.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(input.element)
    expect(select).toHaveBeenCalled()
    other.remove()

    // 不带 Ctrl 的 k 不处理
    const plain = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true })
    document.body.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })
})
