/**
 * 更新状态镜像：主进程 Updater 是真相源，load() 取一次并订阅 update:status；action 只调 SDK。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UpdateStatus } from '@shared/models'
import type { Unsubscribe } from '@shared/api'

export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus>({ state: 'idle' })
  let unsubscribe: Unsubscribe | null = null

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.update.onStatus((next) => {
      status.value = next
    })
    status.value = await window.tagterm.update.getStatus()
  }

  const check = (): Promise<void> => window.tagterm.update.check()
  const download = (): Promise<void> => window.tagterm.update.download()
  const install = (): Promise<void> => window.tagterm.update.install()

  return { status, load, check, download, install }
})
