/**
 * 筛选 UI 状态（只在渲染进程）：分组折叠集合（M2 S2）；选中标签 / 任一-全部 / 搜索词（S3）。
 * 折叠集合持久化到 localStorage（键 tagterm.collapsedGroups，值为分组 key 数组）；
 * 读取失败或格式不对视为空。标签删除后其 key 自然失效，不做清理。
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

export const useFilterStore = defineStore('filter', () => {
  const collapsed = ref<Set<string>>(readCollapsed())

  const isCollapsed = (key: string): boolean => collapsed.value.has(key)

  function toggleCollapsed(key: string): void {
    const next = new Set(collapsed.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsed.value = next
    writeCollapsed(next)
  }

  return { collapsed, isCollapsed, toggleCollapsed }
})
