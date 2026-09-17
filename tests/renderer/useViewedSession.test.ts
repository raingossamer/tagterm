import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import type { TagTermApi } from '@shared/api'
import { useViewedSession } from '../../src/renderer/src/composables/useViewedSession'
import { installFakeApi, makeSession } from './fakeApi'
import { installFakeWorkspace, type FakeWorkspace } from './fakeWorkspace'

const Host = defineComponent({
  setup() {
    useViewedSession()
    return () => h('div')
  },
})

describe('useViewedSession（「正被查看」的会话上报）', () => {
  const a = makeSession({ name: 'a' })
  const b = makeSession({ name: 'b' })
  let api: TagTermApi
  let fake: FakeWorkspace

  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    api = installFakeApi()
    fake = installFakeWorkspace([a, b])
  })
  afterEach(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  it('挂载先上报一次；当前页变化 / 失焦与聚焦 / 隐藏与显示各上报一次（不可见或失焦发 null）；卸载后不再上报', async () => {
    const wrapper = mount(Host)
    const calls = (): unknown[][] => (api.agent.setViewed as any).mock.calls
    expect(calls()).toEqual([[null]])

    await fake.workspace.select(a.id)
    await flushPromises()
    expect(calls().at(-1)).toEqual([a.id])

    window.dispatchEvent(new Event('blur'))
    expect(calls().at(-1)).toEqual([null])
    window.dispatchEvent(new Event('focus'))
    expect(calls().at(-1)).toEqual([a.id])

    setHidden(true)
    expect(calls().at(-1)).toEqual([null])
    // 隐藏期间切换当前页：仍是 null
    await fake.workspace.select(b.id)
    await flushPromises()
    expect(calls().at(-1)).toEqual([null])
    setHidden(false)
    expect(calls().at(-1)).toEqual([b.id])

    const count = calls().length
    wrapper.unmount()
    await fake.workspace.select(a.id)
    await flushPromises()
    window.dispatchEvent(new Event('blur'))
    expect(calls()).toHaveLength(count)
  })
})
