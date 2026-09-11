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
})
