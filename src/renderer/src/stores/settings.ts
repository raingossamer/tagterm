/**
 * 设置镜像：主进程是真相源，load() 拉取一次并订阅 settings:changed 全量替换；
 * action 只调 SDK，不本地改数据。唤起命令按 pinned / sortOrder 拆成平铺区与「更多」。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LaunchCommandInput } from '@shared/ipc'
import type { Settings } from '@shared/models'
import { DEFAULT_TERMINAL_BACKGROUND } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import { normalizeLaunchCommands, splitPinned } from '../composables/launchCommands'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({
    launchCommands: [],
    terminalBackground: DEFAULT_TERMINAL_BACKGROUND,
  })
  let unsubscribe: Unsubscribe | null = null

  const split = computed(() => splitPinned(settings.value.launchCommands))
  const pinnedCommands = computed(() => split.value.pinned)
  const moreCommands = computed(() => split.value.more)
  const launchCommands = computed(() => [...settings.value.launchCommands])

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.settings.onChanged((next) => {
      settings.value = next
    })
    settings.value = await window.tagterm.settings.get()
  }

  /** 编辑弹窗「完成」：规整后整体提交 */
  async function saveLaunchCommands(rows: readonly LaunchCommandInput[]): Promise<void> {
    await window.tagterm.settings.update({ launchCommands: normalizeLaunchCommands(rows) })
  }

  return { settings, launchCommands, pinnedCommands, moreCommands, load, saveLaunchCommands }
})
