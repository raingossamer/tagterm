import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ManageTagsModal from '../../../src/renderer/src/components/ManageTagsModal.vue'
import { useFilterStore } from '../../../src/renderer/src/stores/filter'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { installFakeApi, makeSession, makeTag } from '../fakeApi'

// happy-dom 没有 window.confirm，按需要的返回值打桩
function stubConfirm(result: boolean) {
  const fn = vi.fn(() => result)
  Object.defineProperty(window, 'confirm', { value: fn, configurable: true, writable: true })
  return fn
}

describe('ManageTagsModal', () => {
  const s1 = makeSession()
  const s2 = makeSession()
  const java = makeTag({ name: 'java', color: '#6B7280', sortOrder: 2 }) // 八色表最后一色
  const simba = makeTag({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })

  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    useSessionsStore().sessions = [s1, s2]
    const tags = useTagsStore()
    tags.tags = [java, simba]
    tags.sessionTags = [
      { sessionId: s1.id, tagId: simba.id },
      { sessionId: s1.id, tagId: java.id },
      { sessionId: s2.id, tagId: java.id },
    ]
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('每行 = 色块 / 名称输入框 / 「N 个会话」/ 删除，按 sortOrder；点色块按八色表轮转到下一色（最后一色回到第一色）', async () => {
    const api = installFakeApi()
    const wrapper = mount(ManageTagsModal)
    const rows = wrapper.findAll('[data-test=mt-row]')
    expect(rows).toHaveLength(2)
    expect(
      rows.map((r) => (r.find('[data-test=mt-name]').element as HTMLInputElement).value),
    ).toEqual(['simba', 'java'])
    expect(rows.map((r) => r.find('[data-test=mt-count]').text())).toEqual(['1 个会话', '2 个会话'])
    expect(rows[0]!.find('[data-test=mt-color]').attributes('title')).toBe('换颜色')
    expect(rows[0]!.attributes('style')).toContain('#2F6FDB')

    await rows[0]!.find('[data-test=mt-color]').trigger('click')
    expect(api.tag.update).toHaveBeenCalledWith(simba.id, { color: '#2A9D5C' })
    await rows[1]!.find('[data-test=mt-color]').trigger('click')
    expect(api.tag.update).toHaveBeenCalledWith(java.id, { color: '#2F6FDB' })
  })

  it('改名：change 后调 tag.update；空名不调用且输入框还原', async () => {
    const api = installFakeApi()
    const wrapper = mount(ManageTagsModal)
    const input = wrapper.findAll('[data-test=mt-name]')[0]!
    ;(input.element as HTMLInputElement).value = ' simba-2 '
    await input.trigger('change')
    await flushPromises()
    expect(api.tag.update).toHaveBeenCalledWith(simba.id, { name: ' simba-2 ' })

    ;(input.element as HTMLInputElement).value = '   '
    await input.trigger('change')
    await flushPromises()
    expect(api.tag.update).toHaveBeenCalledTimes(1)
    expect((input.element as HTMLInputElement).value).toBe('simba')
  })

  it('改名撞名：SDK reject → 输入框还原为原名并在行下红字提示，1.2 s 后消失', async () => {
    vi.useFakeTimers()
    const api = installFakeApi({
      tag: { update: vi.fn(async () => Promise.reject(new Error('已有同名标签：java'))) },
    })
    const wrapper = mount(ManageTagsModal)
    const row = wrapper.findAll('[data-test=mt-row]')[0]!
    const input = row.find('[data-test=mt-name]')
    ;(input.element as HTMLInputElement).value = 'java'
    await input.trigger('change')
    await flushPromises()
    expect(api.tag.update).toHaveBeenCalledWith(simba.id, { name: 'java' })
    expect((input.element as HTMLInputElement).value).toBe('simba')
    expect(row.find('[data-test=mt-error]').text()).toBe('已有同名标签：java')

    await vi.advanceTimersByTimeAsync(1200)
    expect(row.find('[data-test=mt-error]').exists()).toBe(false)
  })

  it('删除：confirm 文案正确；取消不删；确认后调 tag.remove 并从筛选选中集合移除', async () => {
    const api = installFakeApi()
    const filter = useFilterStore()
    filter.toggle(java.id)
    filter.toggle(simba.id)
    const wrapper = mount(ManageTagsModal)

    const confirm = stubConfirm(false)
    await wrapper.findAll('[data-test=mt-delete]')[1]!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith('删除标签 "java"？会话本身会保留。')
    expect(api.tag.remove).not.toHaveBeenCalled()
    expect(filter.selected.has(java.id)).toBe(true)

    stubConfirm(true)
    await wrapper.findAll('[data-test=mt-delete]')[1]!.trigger('click')
    await flushPromises()
    expect(api.tag.remove).toHaveBeenCalledWith(java.id)
    expect(filter.selected).toEqual(new Set([simba.id]))
  })

  it('底部「新标签名，回车添加」调 tag.create 并清空；空名不创建；无标签时提示「还没有标签」', async () => {
    const api = installFakeApi()
    const wrapper = mount(ManageTagsModal)
    const input = wrapper.find<HTMLInputElement>('[data-test=mt-new]')
    expect(input.attributes('placeholder')).toBe('新标签名，回车添加')
    await input.setValue(' iot ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.tag.create).toHaveBeenCalledWith(' iot ', undefined)
    expect(input.element.value).toBe('')

    await input.setValue('  ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(api.tag.create).toHaveBeenCalledTimes(1)

    useTagsStore().tags = []
    await flushPromises()
    expect(wrapper.find('[data-test=mt-empty]').text()).toBe('还没有标签')
    expect(wrapper.findAll('[data-test=mt-row]')).toHaveLength(0)
  })

  it('「完成」/ Esc / 点遮罩关闭', async () => {
    installFakeApi()
    const wrapper = mount(ManageTagsModal, { attachTo: document.body })
    await wrapper.find('[data-test=mt-done]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
    await wrapper.find('[data-test=manage-tags-modal]').trigger('mousedown')
    expect(wrapper.emitted('close')).toHaveLength(3)
    wrapper.unmount()
  })
})
