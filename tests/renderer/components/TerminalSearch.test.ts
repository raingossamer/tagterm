import { beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TerminalSearch from '../../../src/renderer/src/components/TerminalSearch.vue'
import { TERMINAL_WORKSPACE_KEY } from '../../../src/renderer/src/terminal/workspaceKey'
import { installFakeApi, makeSession } from '../fakeApi'
import { installFakeWorkspace, type FakeWorkspace } from '../fakeWorkspace'

function pressFind(): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }),
  )
}

describe('TerminalSearch（终端内搜索框，Ctrl+Shift+F）', () => {
  const a = makeSession({ name: 'a' })
  const b = makeSession({ name: 'b' })
  let fake: FakeWorkspace
  let wrapper: VueWrapper

  const box = () => wrapper.find('[data-test=terminal-search]')
  const input = () => wrapper.find<HTMLInputElement>('[data-test=terminal-search-input]')
  const count = () => wrapper.find('[data-test=terminal-search-count]').text()

  async function typeQuery(text: string): Promise<void> {
    await input().setValue(text)
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    installFakeApi()
    fake = installFakeWorkspace([a, b])
    wrapper = mount(TerminalSearch, {
      attachTo: document.body,
      global: { provide: { [TERMINAL_WORKSPACE_KEY as symbol]: fake.core } },
    })
    await fake.workspace.select(a.id)
    fake.pty.emitData(a.id, 'npm ERR! one\r\nerror two\r\nok\r\n')
  })

  it('没有当前会话时 Ctrl+Shift+F 不打开；有当前会话时打开并聚焦输入框（占位「在终端中查找」）', async () => {
    expect(box().exists()).toBe(false)
    fake.workspace.closeTab(a.id)
    pressFind()
    await wrapper.vm.$nextTick()
    expect(box().exists()).toBe(false)

    await fake.workspace.select(a.id)
    pressFind()
    await wrapper.vm.$nextTick()
    expect(box().exists()).toBe(true)
    expect(input().attributes('placeholder')).toBe('在终端中查找')
    expect(document.activeElement).toBe(input().element)
    wrapper.unmount()
  })

  it('输入即搜（边打字边搜，停在当前处）：「第 N 处，共 M 处」；没有匹配「无结果」；清空输入清掉高亮、不显示计数', async () => {
    pressFind()
    await wrapper.vm.$nextTick()
    await typeQuery('err')
    expect(fake.terminals[0]!.searchQuery).toBe('err')
    expect(count()).toBe('第 1 处，共 2 处')

    await typeQuery('zzz')
    expect(count()).toBe('无结果')

    await typeQuery('')
    expect(fake.terminals[0]!.clearSearchCount).toBe(1)
    expect(count()).toBe('')
    wrapper.unmount()
  })

  it('Enter 下一处、Shift+Enter 上一处，↑ ↓ 按钮同样', async () => {
    pressFind()
    await wrapper.vm.$nextTick()
    await typeQuery('err')
    await input().trigger('keydown', { key: 'Enter' })
    expect(count()).toBe('第 2 处，共 2 处')
    await input().trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(count()).toBe('第 1 处，共 2 处')
    await wrapper.find('[data-test=terminal-search-prev]').trigger('click')
    expect(count()).toBe('第 2 处，共 2 处')
    await wrapper.find('[data-test=terminal-search-next]').trigger('click')
    expect(count()).toBe('第 1 处，共 2 处')
    wrapper.unmount()
  })

  it('超出高亮上限（插件给 index -1）显示「共 1000+ 处」', async () => {
    pressFind()
    await wrapper.vm.$nextTick()
    await typeQuery('e')
    fake.terminals[0]!.emitSearchResults({ index: -1, count: 1000 })
    await wrapper.vm.$nextTick()
    expect(count()).toBe('共 1000+ 处')
    wrapper.unmount()
  })

  it('Esc 或 × 关闭：清掉高亮、焦点回到终端', async () => {
    pressFind()
    await wrapper.vm.$nextTick()
    await typeQuery('err')
    const focusBefore = fake.terminals[0]!.focusCount
    await input().trigger('keydown', { key: 'Escape' })
    expect(box().exists()).toBe(false)
    expect(fake.terminals[0]!.clearSearchCount).toBe(1)
    expect(fake.terminals[0]!.focusCount).toBe(focusBefore + 1)

    pressFind()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test=terminal-search-close]').trigger('click')
    expect(box().exists()).toBe(false)
    expect(fake.terminals[0]!.clearSearchCount).toBe(2)
    wrapper.unmount()
  })

  it('再次打开预填上次的词并全选；开着时再按 Ctrl+Shift+F 聚焦并全选', async () => {
    pressFind()
    await wrapper.vm.$nextTick()
    await typeQuery('error')
    await input().trigger('keydown', { key: 'Escape' })

    pressFind()
    await wrapper.vm.$nextTick()
    const el = input().element
    expect(el.value).toBe('error')
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 5])
    expect(count()).toBe('')

    el.setSelectionRange(5, 5)
    el.blur()
    pressFind()
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(el)
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 5])
    wrapper.unmount()
  })

  it('切到别的会话：搜索框关闭、原会话的高亮清掉；原会话之后迟到的结果不再显示', async () => {
    pressFind()
    await wrapper.vm.$nextTick()
    await typeQuery('err')
    await fake.workspace.select(b.id)
    await wrapper.vm.$nextTick()
    expect(box().exists()).toBe(false)
    expect(fake.terminals[0]!.clearSearchCount).toBe(1)

    pressFind()
    await wrapper.vm.$nextTick()
    fake.terminals[0]!.emitSearchResults({ index: 0, count: 9 })
    await wrapper.vm.$nextTick()
    expect(count()).toBe('')
    wrapper.unmount()
  })
})
