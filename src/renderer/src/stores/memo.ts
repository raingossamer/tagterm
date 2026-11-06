/**
 * 本周备忘的镜像：主进程是真相源，load() 拉取一次并订阅 memo:changed 全量替换；
 * action 只调 SDK，不本地改数据。归哪一周由 shared/week 按时间推算，不在这里。
 * 另管弹窗开关（UI 状态）：开 / 关各报主进程一次（备忘录热键据此判定开还是关），关掉后焦点回到当前终端。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MemoPatch } from '@shared/ipc'
import type { MemoItem } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import { useWorkspaceStore } from './workspace'

export const useMemoStore = defineStore('memo', () => {
  const workspace = useWorkspaceStore()
  const items = ref<MemoItem[]>([])
  const isOpen = ref(false)
  let unsubscribe: Unsubscribe | null = null

  function open(): void {
    if (isOpen.value) return
    isOpen.value = true
    window.tagterm.app.reportMemoVisibility(true)
  }

  function close(): void {
    if (!isOpen.value) return
    isOpen.value = false
    window.tagterm.app.reportMemoVisibility(false)
    workspace.focusActive()
  }

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.memo.onChanged((next) => {
      items.value = next
    })
    items.value = await window.tagterm.memo.list()
  }

  function create(text: string): Promise<MemoItem> {
    return window.tagterm.memo.create(text)
  }

  function update(id: string, patch: MemoPatch): Promise<MemoItem> {
    return window.tagterm.memo.update(id, patch)
  }

  function remove(id: string): Promise<void> {
    return window.tagterm.memo.remove(id)
  }

  return { items, isOpen, open, close, load, create, update, remove }
})
