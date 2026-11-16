import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MemoPanel from '../../../src/renderer/src/components/MemoPanel.vue'
import { useMemoStore } from '../../../src/renderer/src/stores/memo'
import { installFakeMemoApi, makeMemo } from '../fakeApi'
import type { MemoWindowApi } from '@shared/api'

// memo-floating-window：备忘小窗的整页（迁移自原 MemoModal 的测试，弹窗特有的遮罩 / 「完成」按钮已取消）
/** 本地时间：2026-11-06 周五 = 2026 W45（11/2–11/8） */
const at = (m: number, d: number, h = 12): string => new Date(2026, m - 1, d, h).toISOString()
const now = new Date(2026, 10, 6, 12)

describe('MemoPanel：备忘小窗', () => {
  let api: MemoWindowApi
  let focusInput: (() => void) | null = null
  let wrapper: VueWrapper | null = null
  const carried = makeMemo({ text: '上周没做完', createdAt: at(10, 28) })
  const fresh = makeMemo({ text: '本周新加', createdAt: at(11, 5) })
  const doneThis = makeMemo({
    text: '本周做完',
    createdAt: at(11, 3),
    done: true,
    doneAt: at(11, 4),
  })
  const doneLast = makeMemo({
    text: '上周做完',
    createdAt: at(10, 27),
    done: true,
    doneAt: at(10, 30),
  })
  const doneOld = makeMemo({
    text: '三周前做完',
    createdAt: at(10, 12),
    done: true,
    doneAt: at(10, 14),
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    focusInput = null
    api = installFakeMemoApi({
      memoWindow: {
        onFocusInput: (cb) => {
          focusInput = cb
          return () => {}
        },
      },
    })
    useMemoStore().items = [fresh, doneThis, doneLast, carried, doneOld]
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  function open(): VueWrapper {
    wrapper = mount(MemoPanel, { props: { now }, attachTo: document.body })
    return wrapper
  }
  const texts = (w: VueWrapper, scope = ''): string[] =>
    w.findAll(`${scope} [data-test=memo-text]`).map((t) => t.text())

  it('标题栏写本周的周号与起止；进度「已完成 1 / 3」；待办在上（延续来的标「自 W44」）、已完成一组在下；往周做完的不在本周', () => {
    const w = open()

    expect(w.find('[data-test=memo-week-name]').text()).toBe('W45')
    expect(w.find('[data-test=memo-week-range]').text()).toBe('11/2–11/8')
    expect(w.find('[data-test=memo-progress]').text()).toBe('已完成 1 / 3')
    expect(texts(w, '[data-test=memo-todo]')).toEqual(['上周没做完', '本周新加'])
    expect(w.find('[data-test=memo-todo-count]').text()).toBe('2')
    expect(texts(w, '[data-test=memo-done-list]')).toEqual(['本周做完'])
    expect(w.find('[data-test=memo-done-count]').text()).toBe('1')
    expect(w.findAll('[data-test=memo-carried]').map((t) => t.text())).toEqual(['自 W44'])
    const doneRow = w.find('[data-test=memo-done-list] [data-test=memo-item]')
    expect(doneRow.classes()).toContain('done')
    expect((doneRow.find('[data-test=memo-done]').element as HTMLInputElement).checked).toBe(true)
  })

  it('打开时焦点在输入框；回车添加后清空、焦点留在原处；空白不添加', async () => {
    const w = open()
    const input = w.find('[data-test=memo-input]')
    expect(document.activeElement).toBe(input.element)

    await input.setValue('  ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(api.memo.create).not.toHaveBeenCalled()

    await input.setValue('写周报')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.memo.create).toHaveBeenCalledWith('写周报')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(input.element)
  })

  it('主进程让聚焦输入框（热键 / 托盘再次打开）：翻在往周时回到本周，焦点进输入框', async () => {
    const w = open()
    await w.find('[data-test=memo-prev]').trigger('click')
    expect(w.find('[data-test=memo-input]').exists()).toBe(false)
    ;(document.activeElement as HTMLElement | null)?.blur()

    focusInput!()
    await flushPromises()
    expect(w.find('[data-test=memo-week-name]').text()).toBe('W45')
    expect(document.activeElement).toBe(w.find('[data-test=memo-input]').element)
  })

  it('添加失败：标题栏下红字写原因、输入框保留原文；下一次成功后红字消失', async () => {
    let fail = true
    api.memo.create = async (text) => {
      if (fail) throw new Error('写盘失败')
      return makeMemo({ text })
    }
    const w = open()
    const input = w.find('[data-test=memo-input]')
    await input.setValue('写周报')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(w.find('[data-test=memo-error]').text()).toBe('写盘失败')
    expect((input.element as HTMLInputElement).value).toBe('写周报')

    fail = false
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(w.find('[data-test=memo-error]').exists()).toBe(false)
  })

  it('勾选 / 取消勾选；删除不弹确认', async () => {
    const w = open()
    const todo = w.findAll('[data-test=memo-todo] [data-test=memo-item]')
    const done = w.findAll('[data-test=memo-done-list] [data-test=memo-item]')

    await todo[0]!.find('[data-test=memo-done]').setValue(true)
    await done[0]!.find('[data-test=memo-done]').setValue(false)
    await todo[1]!.find('[data-test=memo-remove]').trigger('click')

    expect(api.memo.update).toHaveBeenNthCalledWith(1, carried.id, { done: true })
    expect(api.memo.update).toHaveBeenNthCalledWith(2, doneThis.id, { done: false })
    expect(api.memo.remove).toHaveBeenCalledWith(fresh.id)
  })

  it('点文字就地改：回车提交；改成空白还原不提交；编辑框里的 Esc 只取消编辑、不关小窗', async () => {
    const w = open()
    const second = (): ReturnType<VueWrapper['find']> =>
      w.findAll('[data-test=memo-todo] [data-test=memo-text]')[1]!
    await second().trigger('click')
    let edit = w.find('[data-test=memo-edit]')
    expect(document.activeElement).toBe(edit.element)
    await edit.setValue('本周新加（改）')
    await edit.trigger('keydown', { key: 'Enter' })
    expect(api.memo.update).toHaveBeenCalledWith(fresh.id, { text: '本周新加（改）' })
    expect(w.find('[data-test=memo-edit]').exists()).toBe(false)

    await second().trigger('click')
    edit = w.find('[data-test=memo-edit]')
    await edit.setValue('   ')
    await edit.trigger('keydown', { key: 'Enter' })
    expect(api.memo.update).toHaveBeenCalledTimes(1)

    await second().trigger('click')
    w.find('[data-test=memo-edit]').element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flushPromises()
    expect(w.find('[data-test=memo-edit]').exists()).toBe(false)
    expect(api.memoWindow.close).not.toHaveBeenCalled()
  })

  it('‹ 翻到往周只读：顶部「只读」与「这一周完成了 N 项」，只有那一周做完的，没有输入框、删除，勾选框不可用、文字不能改；最早一周不能再往前，本周不能往后；「回到本周」', async () => {
    const w = open()
    expect(w.find('[data-test=memo-next]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-test=memo-readonly]').exists()).toBe(false)

    await w.find('[data-test=memo-prev]').trigger('click')
    expect(w.find('[data-test=memo-week-name]').text()).toBe('W44')
    expect(w.find('[data-test=memo-week-range]').text()).toBe('10/26–11/1')
    expect(w.find('[data-test=memo-readonly]').text()).toContain('W44 · 只读')
    expect(w.find('[data-test=memo-readonly]').text()).toContain('这一周完成了 1 项')
    expect(w.find('[data-test=memo-progress]').exists()).toBe(false)
    expect(texts(w)).toEqual(['上周做完'])
    expect(w.find('[data-test=memo-input]').exists()).toBe(false)
    expect(w.find('[data-test=memo-remove]').exists()).toBe(false)
    expect(w.find('[data-test=memo-done]').attributes('disabled')).toBeDefined()
    await w.findAll('[data-test=memo-text]')[0]!.trigger('click')
    expect(w.find('[data-test=memo-edit]').exists()).toBe(false)

    await w.find('[data-test=memo-prev]').trigger('click')
    expect(w.find('[data-test=memo-empty]').text()).toBe('这一周没有完成的事项')
    await w.find('[data-test=memo-prev]').trigger('click')
    expect(texts(w)).toEqual(['三周前做完'])
    expect(w.find('[data-test=memo-prev]').attributes('disabled')).toBeDefined()

    await w.find('[data-test=memo-back]').trigger('click')
    expect(w.find('[data-test=memo-week-name]').text()).toBe('W45')
    expect(w.find('[data-test=memo-input]').exists()).toBe(true)
  })

  it('本周没有事项时提示、不显示进度；Esc 与标题栏 × 都关掉小窗', async () => {
    useMemoStore().items = []
    const w = open()
    expect(w.find('[data-test=memo-empty]').text()).toContain('本周还没有事项')
    expect(w.find('[data-test=memo-progress]').exists()).toBe(false)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.find('[data-test=memo-close]').trigger('click')
    expect(api.memoWindow.close).toHaveBeenCalledTimes(2)
  })

  it('「已完成」一组可以折叠，折叠与否记在 localStorage（tagterm.memoDoneCollapsed），重开仍在', async () => {
    let w = open()
    await w.find('[data-test=memo-done-toggle]').trigger('click')
    expect(w.find('[data-test=memo-done-list]').exists()).toBe(false)
    expect(localStorage.getItem('tagterm.memoDoneCollapsed')).toBe('1')

    w.unmount()
    w = open()
    expect(w.find('[data-test=memo-done-list]').exists()).toBe(false)
    await w.find('[data-test=memo-done-toggle]').trigger('click')
    expect(w.find('[data-test=memo-done-list]').exists()).toBe(true)
    expect(localStorage.getItem('tagterm.memoDoneCollapsed')).toBe('0')
  })

  it('拖出：只有把手可拖，拖的是这条事项的文字（text/plain）；拖动中那一行变淡，松手复原', async () => {
    const w = open()
    const row = w.findAll('[data-test=memo-todo] [data-test=memo-item]')[1]!
    expect(row.attributes('draggable')).toBeUndefined()
    const grip = row.find('[data-test=memo-grip]')
    expect(grip.attributes('draggable')).toBe('true')

    const data: Record<string, string> = {}
    const transfer = {
      effectAllowed: 'all',
      setData: (type: string, value: string) => {
        data[type] = value
      },
    }
    const start = new Event('dragstart', { bubbles: true })
    Object.defineProperty(start, 'dataTransfer', { value: transfer })
    grip.element.dispatchEvent(start)
    await flushPromises()
    expect(data).toEqual({ 'text/plain': '本周新加' })
    expect(transfer.effectAllowed).toBe('copy')
    expect(row.classes()).toContain('dragging')

    grip.element.dispatchEvent(new Event('dragend', { bubbles: true }))
    await flushPromises()
    expect(row.classes()).not.toContain('dragging')
  })
})
