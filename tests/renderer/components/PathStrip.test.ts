import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PathStrip from '../../../src/renderer/src/components/PathStrip.vue'
import { useSessionsStore } from '../../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { installFakeApi, makeSession } from '../fakeApi'

// happy-dom 没有 window.confirm，按需要的返回值打桩
function stubConfirm(result: boolean) {
  const fn = vi.fn(() => result)
  Object.defineProperty(window, 'confirm', { value: fn, configurable: true, writable: true })
  return fn
}

describe('PathStrip', () => {
  const session = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api' })
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionsStore().sessions = [session]
    useWorkspaceStore().select(session.id)
    writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('显示当前会话的完整路径；「复制」写入剪贴板并短暂显示「已复制」', async () => {
    vi.useFakeTimers()
    installFakeApi()
    const wrapper = mount(PathStrip)

    expect(wrapper.find('[data-test=strip-path]').text()).toBe('D:\\Projects\\simba\\api')

    const copy = wrapper.find('[data-test=strip-copy]')
    await copy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('D:\\Projects\\simba\\api')
    expect(copy.text()).toBe('已复制')

    await vi.advanceTimersByTimeAsync(1200)
    expect(copy.text()).toBe('复制')
  })

  it('「移除会话」按原型文案确认；确认后调 SDK 移除并关闭其标签页', async () => {
    const api = installFakeApi()
    const confirm = stubConfirm(true)
    const wrapper = mount(PathStrip)

    await wrapper.find('[data-test=strip-remove]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('移除会话 "simba-api"？终端进程会被结束。')
    expect(api.session.remove).toHaveBeenCalledWith(session.id)
    expect(useWorkspaceStore().activeId).toBeNull()
  })

  it('取消确认则不移除', async () => {
    const api = installFakeApi()
    stubConfirm(false)
    const wrapper = mount(PathStrip)

    await wrapper.find('[data-test=strip-remove]').trigger('click')
    await flushPromises()

    expect(api.session.remove).not.toHaveBeenCalled()
    expect(useWorkspaceStore().activeId).toBe(session.id)
  })
})
