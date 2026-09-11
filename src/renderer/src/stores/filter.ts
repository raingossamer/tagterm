/**
 * 筛选 UI 状态（只在渲染进程）：选中标签集合、任一 / 全部模式、搜索词、分组折叠集合。
 * 只有折叠集合持久化到 localStorage（键 tagterm.collapsedGroups，值为分组 key 数组；
 * 读取失败或格式不对视为空；标签删除后其 key 自然失效，不做清理）；其余不跨重启保留。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const COLLAPSED_STORAGE_KEY = 'tagterm.collapsedGroups'

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

function writeCollapsed(keys: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...keys]))
  } catch (err) {
    console.warn('[filter] 折叠状态写入 localStorage 失败', err)
  }
}

export type FilterMode = 'any' | 'all'

export const useFilterStore = defineStore('filter', () => {
  const selected = ref<Set<string>>(new Set())
  const mode = ref<FilterMode>('any')
  const search = ref('')
  const collapsed = ref<Set<string>>(readCollapsed())

  function toggle(tagId: string): void {
    const next = new Set(selected.value)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    selected.value = next
  }

  /** 删除标签时从选中集合移除（不在集合里静默） */
  function deselect(tagId: string): void {
    if (!selected.value.has(tagId)) return
    const next = new Set(selected.value)
    next.delete(tagId)
    selected.value = next
  }

  /** 「清除」只清选中标签，不动模式与搜索词（原型行为） */
  function clear(): void {
    selected.value = new Set()
  }

  function setMode(next: FilterMode): void {
    mode.value = next
  }

  function setSearch(next: string): void {
    search.value = next
  }

  const isCollapsed = (key: string): boolean => collapsed.value.has(key)

  function toggleCollapsed(key: string): void {
    const next = new Set(collapsed.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsed.value = next
    writeCollapsed(next)
  }

  return {
    selected,
    mode,
    search,
    collapsed,
    toggle,
    deselect,
    clear,
    setMode,
    setSearch,
    isCollapsed,
    toggleCollapsed,
  }
})
