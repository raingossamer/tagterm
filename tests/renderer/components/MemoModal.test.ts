import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MemoModal from '../../../src/renderer/src/components/MemoModal.vue'
import { useMemoStore } from '../../../src/renderer/src/stores/memo'
import { installFakeApi, makeMemo } from '../fakeApi'
import type { TagTermApi } from '@shared/api'

/** 本地时间：2026-11-06 周五 = 2026 W45（11/2–11/8） */
const at = (m: number, d: number, h = 12): string => new Date(2026, m - 1, d, h).toISOString()
const now = new Date(2026, 10, 6, 12)

describe('MemoModal：本周备忘', () => {
  let api: TagTermApi
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
    api = installFakeApi()
    useMemoStore().items = [fresh, doneThis, doneLast, carried, doneOld]
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  function open(): VueWrapper {
    wrapper = mount(MemoModal, { props: { now }, attachTo: document.body })
    return wrapper
  }
  const texts = (w: VueWrapper): string[] => w.findAll('[data-test=memo-text]').map((t) => t.text())

  it('标题写本周的周号与起止；未完成在前（延续来的标「自 W44」）、已完成沉底；往周做完的不在本周', () => {
    const w = open()

    expect(w.find('[data-test=memo-week]').text()).toBe('W45（11/2–11/8）')
    expect(texts(w)).toEqual(['上周没做完', '本周新加', '本周做完'])
    expect(w.findAll('[data-test=memo-carried]').map((t) => t.text())).toEqual(['自 W44'])
    const rows = w.findAll('[data-test=memo-item]')
    expect(rows[2]!.classes()).toContain('done')
    expect((rows[2]!.find('[data-test=memo-done]').element as HTMLInputElement).checked).toBe(true)
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

  it('添加失败：红字写原因、输入框保留原文', async () => {
    api.memo.create = async () => {
      throw new Error('写盘失败')
    }
    const w = open()
    const input = w.find('[data-test=memo-input]')
    await input.setValue('写周报')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(w.find('[data-test=memo-error]').text()).toBe('写盘失败')
    expect((input.element as HTMLInputElement).value).toBe('写周报')
  })

  it('勾选 / 取消勾选；删除不弹确认', async () => {
    const w = open()
    const rows = w.findAll('[data-test=memo-item]')

    await rows[0]!.find('[data-test=memo-done]').setValue(true)
    await rows[2]!.find('[data-test=memo-done]').setValue(false)
    await rows[1]!.find('[data-test=memo-remove]').trigger('click')

    expect(api.memo.update).toHaveBeenNthCalledWith(1, carried.id, { done: true })
    expect(api.memo.update).toHaveBeenNthCalledWith(2, doneThis.id, { done: false })
    expect(api.memo.remove).toHaveBeenCalledWith(fresh.id)
  })

  it('点文字就地改：回车提交；改成空白还原不提交；编辑框里的 Esc 只取消编辑、不关弹窗', async () => {
    const w = open()
    await w.findAll('[data-test=memo-text]')[1]!.trigger('click')
    let edit = w.find('[data-test=memo-edit]')
    expect(document.activeElement).toBe(edit.element)
    await edit.setValue('本周新加（改）')
    await edit.trigger('keydown', { key: 'Enter' })
    expect(api.memo.update).toHaveBeenCalledWith(fresh.id, { text: '本周新加（改）' })
    expect(w.find('[data-test=memo-edit]').exists()).toBe(false)

    await w.findAll('[data-test=memo-text]')[1]!.trigger('click')
    edit = w.find('[data-test=memo-edit]')
    await edit.setValue('   ')
    await edit.trigger('keydown', { key: 'Enter' })
    expect(api.memo.update).toHaveBeenCalledTimes(1)

    await w.findAll('[data-test=memo-text]')[1]!.trigger('click')
    w.find('[data-test=memo-edit]').element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flushPromises()
    expect(w.find('[data-test=memo-edit]').exists()).toBe(false)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('‹ 翻到往周只读：只有那一周做完的，没有输入框、删除，勾选框不可用；最早一周不能再往前，本周不能往后', async () => {
    const w = open()
    expect(w.find('[data-test=memo-next]').attributes('disabled')).toBeDefined()

    await w.find('[data-test=memo-prev]').trigger('click')
    expect(w.find('[data-test=memo-week]').text()).toBe('W44（10/26–11/1）')
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

    for (let i = 0; i < 3; i += 1) await w.find('[data-test=memo-next]').trigger('click')
    expect(w.find('[data-test=memo-week]').text()).toBe('W45（11/2–11/8）')
    expect(w.find('[data-test=memo-input]').exists()).toBe(true)
  })

  it('本周没有事项时提示；Esc、点遮罩、「完成」都发出 close', async () => {
    useMemoStore().items = []
    const w = open()
    expect(w.find('[data-test=memo-empty]').text()).toBe('本周还没有事项')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.find('[data-test=memo-modal]').trigger('mousedown')
    await w.find('[data-test=memo-close]').trigger('click')
    expect(w.emitted('close')).toHaveLength(3)
  })
})
