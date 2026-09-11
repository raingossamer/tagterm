import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFilterStore, COLLAPSED_STORAGE_KEY } from '../../src/renderer/src/stores/filter'

describe('filter store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('toggleCollapsed 折叠 / 展开分组并写入 localStorage；重新创建 store 后仍折叠', () => {
    const filter = useFilterStore()
    expect(filter.isCollapsed('t1')).toBe(false)

    filter.toggleCollapsed('t1')
    filter.toggleCollapsed('untagged')
    expect(filter.isCollapsed('t1')).toBe(true)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toEqual(['t1', 'untagged'])

    filter.toggleCollapsed('t1')
    expect(filter.isCollapsed('t1')).toBe(false)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toEqual(['untagged'])

    setActivePinia(createPinia())
    const fresh = useFilterStore()
    expect(fresh.isCollapsed('untagged')).toBe(true)
    expect(fresh.isCollapsed('t1')).toBe(false)
  })

  it('localStorage 内容非法或不是字符串数组时视为空，不报错', () => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, '{ not json')
    expect(useFilterStore().isCollapsed('t1')).toBe(false)

    setActivePinia(createPinia())
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ t1: true }))
    expect(useFilterStore().isCollapsed('t1')).toBe(false)

    setActivePinia(createPinia())
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(['t1', 5, null]))
    const filter = useFilterStore()
    expect(filter.isCollapsed('t1')).toBe(true)
    expect(filter.collapsed).toEqual(new Set(['t1']))
  })

  it('toggle 选中 / 取消标签，clear 清空选中，setMode / setSearch / deselect；这些都不持久化', () => {
    const filter = useFilterStore()
    expect(filter.selected.size).toBe(0)
    expect(filter.mode).toBe('any')
    expect(filter.search).toBe('')

    filter.toggle('t1')
    filter.toggle('t2')
    expect(filter.selected).toEqual(new Set(['t1', 't2']))
    filter.toggle('t1')
    expect(filter.selected).toEqual(new Set(['t2']))
    filter.setMode('all')
    filter.setSearch(' api ')
    expect(filter.mode).toBe('all')
    expect(filter.search).toBe(' api ')
    filter.deselect('t2')
    filter.deselect('t2') // 不在集合里也不报错
    expect(filter.selected.size).toBe(0)
    filter.toggle('t3')
    filter.clear()
    expect(filter.selected.size).toBe(0)
    expect(filter.mode).toBe('all') // clear 只清选中，不动模式与搜索词
    expect(localStorage.length).toBe(0)
  })
})
