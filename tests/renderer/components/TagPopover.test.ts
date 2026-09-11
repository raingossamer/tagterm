import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TagPopover from '../../../src/renderer/src/components/TagPopover.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useTagsStore } from '../../../src/renderer/src/stores/tags'
import { installFakeApi, makeSession, makeTag } from '../fakeApi'

describe('TagPopover', () => {
  const session = makeSession({ name: 'api' })
  const java = makeTag({ name: 'java', color: '#C98A0C', sortOrder: 2 })
  const simba = makeTag({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })
  let api: ReturnType<typeof installFakeApi>
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionsStore().sessions = [session]
    const tags = useTagsStore()
    tags.tags = [java, simba]
    tags.sessionTags = [{ sessionId: session.id, tagId: java.id }]
    api = installFakeApi()
    wrapper = mount(TagPopover, { props: { sessionId: session.id }, attachTo: document.body })
  })
  afterEach(() => {
    wrapper.unmount()
  })

  it('列出全部标签（按 sortOrder，带色点），已加的显示 ✓；点击未加的 attach、已加的 detach，弹出层保持打开', async () => {
    const opts = wrapper.findAll('[data-test=tag-pop-opt]')
    expect(opts.map((o) => o.text())).toEqual(['simba', 'java✓'])
    expect(opts[0]!.attributes('style')).toContain('#2F6FDB')
    expect(opts[0]!.find('[data-test=tag-pop-check]').exists()).toBe(false)
    expect(opts[1]!.find('[data-test=tag-pop-check]').exists()).toBe(true)

    await opts[0]!.trigger('click')
    expect(api.tag.attach).toHaveBeenCalledWith(session.id, simba.id)
    await opts[1]!.trigger('click')
    expect(api.tag.detach).toHaveBeenCalledWith(session.id, java.id)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('[data-test=tag-pop]').exists()).toBe(true)
  })

  it('底部输入框回车：create 后 attach，输入框清空；空名不创建；打开时输入框自动聚焦', async () => {
    const input = wrapper.find<HTMLInputElement>('[data-test=tag-pop-new]')
    expect(input.attributes('placeholder')).toBe('新标签名，回车创建并加上')
    expect(document.activeElement).toBe(input.element)

    await input.setValue('  iot ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.tag.create).toHaveBeenCalledWith('  iot ', undefined)
    const created = await (
      api.tag.create as unknown as { mock: { results: { value: Promise<{ id: string }> }[] } }
    ).mock.results[0]!.value
    expect(api.tag.attach).toHaveBeenCalledWith(session.id, created.id)
    expect(input.element.value).toBe('')

    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.tag.create).toHaveBeenCalledTimes(1)
  })

  it('Esc 关闭（emit close）', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
