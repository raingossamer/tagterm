/**
 * 本周备忘的镜像：主进程是真相源，load() 拉取一次并订阅 memo:changed 全量替换；
 * action 只调 SDK，不本地改数据。归哪一周由 shared/week 按时间推算，不在这里。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MemoPatch } from '@shared/ipc'
import type { MemoItem } from '@shared/models'
import type { Unsubscribe } from '@shared/api'

export const useMemoStore = defineStore('memo', () => {
  const items = ref<MemoItem[]>([])
  let unsubscribe: Unsubscribe | null = null

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

  return { items, load, create, update, remove }
})
