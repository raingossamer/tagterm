/**
 * 本周备忘的镜像（只在备忘小窗里用，memo-floating-window）：主进程是真相源，load() 拉取一次并订阅 memo:changed 全量替换；
 * action 只调 SDK，不本地改数据。归哪一周由 shared/week 按时间推算，不在这里。小窗的开关归主进程，不在 store。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MemoPatch } from '@shared/ipc'
import type { MemoItem } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import { memoApi } from '../memo/memoApi'

export const useMemoStore = defineStore('memo', () => {
  const items = ref<MemoItem[]>([])
  /** 拉取失败的原因（页面标题栏下红字显示）；小窗只有这一份数据，失败不往上抛 */
  const loadError = ref('')
  let unsubscribe: Unsubscribe | null = null

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = memoApi().memo.onChanged((next) => {
      items.value = next
    })
    try {
      items.value = await memoApi().memo.list()
      loadError.value = ''
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : String(err)
      console.error('[memo] 读取备忘事项失败', err)
    }
  }

  function create(text: string): Promise<MemoItem> {
    return memoApi().memo.create(text)
  }

  function update(id: string, patch: MemoPatch): Promise<MemoItem> {
    return memoApi().memo.update(id, patch)
  }

  function remove(id: string): Promise<void> {
    return memoApi().memo.remove(id)
  }

  return { items, loadError, load, create, update, remove }
})
