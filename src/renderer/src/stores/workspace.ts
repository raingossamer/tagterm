/**
 * 工作区 UI 状态（只在渲染进程）：打开的标签页、当前会话、侧栏收起。
 * 标签页语义照原型：选中即加标签页；关闭当前页激活 openTabs[min(i, len-1)]；全关回到空状态。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useWorkspaceStore = defineStore('workspace', () => {
  const openTabs = ref<string[]>([])
  const activeId = ref<string | null>(null)

  const isOpen = (id: string): boolean => openTabs.value.includes(id)
  const hasActive = computed(() => activeId.value !== null)

  function select(id: string): void {
    if (!openTabs.value.includes(id)) openTabs.value.push(id)
    activeId.value = id
  }

  /** 从标签页移除；若是当前会话，激活原位置的邻居（靠后优先，越界取最后一个） */
  function closeTab(id: string): void {
    const i = openTabs.value.indexOf(id)
    if (i < 0) return
    openTabs.value.splice(i, 1)
    if (activeId.value === id) {
      activeId.value = openTabs.value[Math.min(i, openTabs.value.length - 1)] ?? null
    }
  }

  function onSessionRemoved(id: string): void {
    closeTab(id)
  }

  return { openTabs, activeId, isOpen, hasActive, select, closeTab, onSessionRemoved }
})
