/**
 * 设置镜像：主进程是真相源，load() 拉取一次并订阅 settings:changed 全量替换；
 * action 只调 SDK，不本地改数据。唤起命令按 pinned / sortOrder 拆成平铺区与「更多」；
 * 背景图以 data: URL 镜像（imagePath 变化时向主进程重新读取），遮罩不透明度可临时预览。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LaunchCommandInput } from '@shared/ipc'
import type { Settings, TerminalBackground } from '@shared/models'
import { DEFAULT_TERMINAL_BACKGROUND } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import { normalizeLaunchCommands, splitPinned } from '../composables/launchCommands'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({
    launchCommands: [],
    terminalBackground: DEFAULT_TERMINAL_BACKGROUND,
  })
  /** 背景图的 data: URL；未设置或文件不存在为 null（纯色） */
  const backgroundImage = ref<string | null>(null)
  /** 设置弹窗拖动滑块时的即时预览，保存或收到广播后清除 */
  const dimPreview = ref<number | null>(null)
  let unsubscribe: Unsubscribe | null = null

  const terminalBackground = computed<TerminalBackground>(() => ({
    ...settings.value.terminalBackground,
    dimOpacity: dimPreview.value ?? settings.value.terminalBackground.dimOpacity,
  }))

  const split = computed(() => splitPinned(settings.value.launchCommands))
  const pinnedCommands = computed(() => split.value.pinned)
  const moreCommands = computed(() => split.value.more)
  const launchCommands = computed(() => [...settings.value.launchCommands])

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.settings.onChanged((next) => void applyBroadcast(next))
    settings.value = await window.tagterm.settings.get()
    await refreshBackground()
  }

  async function applyBroadcast(next: Settings): Promise<void> {
    const imageChanged =
      next.terminalBackground.imagePath !== settings.value.terminalBackground.imagePath
    settings.value = next
    dimPreview.value = null
    if (imageChanged) await refreshBackground()
  }

  async function refreshBackground(): Promise<void> {
    if (!settings.value.terminalBackground.imagePath) {
      backgroundImage.value = null
      return
    }
    try {
      backgroundImage.value = await window.tagterm.settings.readBackgroundImage()
    } catch (err) {
      console.error('[settings] 读取背景图失败', err)
      backgroundImage.value = null
    }
  }

  function previewDim(dimOpacity: number): void {
    dimPreview.value = dimOpacity
  }

  async function saveTerminalBackground(bg: TerminalBackground): Promise<void> {
    await window.tagterm.settings.update({ terminalBackground: bg })
    dimPreview.value = null
  }

  /** 编辑弹窗「完成」：规整后整体提交 */
  async function saveLaunchCommands(rows: readonly LaunchCommandInput[]): Promise<void> {
    await window.tagterm.settings.update({ launchCommands: normalizeLaunchCommands(rows) })
  }

  return {
    settings,
    backgroundImage,
    terminalBackground,
    launchCommands,
    pinnedCommands,
    moreCommands,
    load,
    saveLaunchCommands,
    saveTerminalBackground,
    previewDim,
  }
})
