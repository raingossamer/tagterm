/**
 * 设置镜像：主进程是真相源，load() 拉取一次并订阅 settings:changed 全量替换；
 * action 只调 SDK，不本地改数据。唤起命令按 pinned / sortOrder 拆成平铺区与「更多」。
 * 全局背景另有一层「预览」：设置弹窗外观段的改动先进预览（整窗即时生效但不落盘），
 * 「保存设置」才提交，「取消」传 null 还原为已保存值。背景图以 data: URL 镜像，路径变了才重新读。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LaunchCommandInput } from '@shared/ipc'
import type { AppBackground, Settings } from '@shared/models'
import { DEFAULT_BACKGROUND } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import { normalizeLaunchCommands, splitPinned } from '../composables/launchCommands'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({
    launchCommands: [],
    background: DEFAULT_BACKGROUND,
  })
  /** 当前生效背景图的 data: URL；未设置或文件不存在为 null（纯色） */
  const backgroundImage = ref<string | null>(null)
  /** 设置弹窗外观段的实时预览，保存或收到广播后清除 */
  const preview = ref<AppBackground | null>(null)
  /** backgroundImage 对应的路径，避免同一张图重复经 IPC 读取 */
  let loadedPath: string | null = null
  let unsubscribe: Unsubscribe | null = null

  /** 界面一律用这个：有预览以预览为准 */
  const background = computed<AppBackground>(() => preview.value ?? settings.value.background)

  /** 面板底色的不透明度：没有背景图时面板恢复完全不透明（决策 7） */
  const panelOpacity = computed(() => (backgroundImage.value ? background.value.panelOpacity : 1))

  const split = computed(() => splitPinned(settings.value.launchCommands))
  const pinnedCommands = computed(() => split.value.pinned)
  const moreCommands = computed(() => split.value.more)
  const launchCommands = computed(() => [...settings.value.launchCommands])

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.settings.onChanged((next) => void applyBroadcast(next))
    settings.value = await window.tagterm.settings.get()
    await refreshImage()
  }

  async function applyBroadcast(next: Settings): Promise<void> {
    settings.value = next
    preview.value = null
    await refreshImage()
  }

  /** 按当前生效背景的 imagePath 同步 data: URL；路径没变就不重复读 */
  async function refreshImage(): Promise<void> {
    const path = background.value.imagePath
    if (path === loadedPath) return
    backgroundImage.value = path ? await window.tagterm.settings.readBackgroundImage(path) : null
    loadedPath = path
  }

  /** 外观段预览：传 null 还原为已保存值。换图时会读新图，读取失败（如图片太大）原样抛给调用处提示 */
  async function previewBackground(next: AppBackground | null): Promise<void> {
    preview.value = next
    await refreshImage()
  }

  async function saveBackground(next: AppBackground): Promise<void> {
    await window.tagterm.settings.update({ background: next })
    preview.value = null
  }

  /** 编辑弹窗「完成」：规整后整体提交 */
  async function saveLaunchCommands(rows: readonly LaunchCommandInput[]): Promise<void> {
    await window.tagterm.settings.update({ launchCommands: normalizeLaunchCommands(rows) })
  }

  return {
    settings,
    backgroundImage,
    background,
    panelOpacity,
    launchCommands,
    pinnedCommands,
    moreCommands,
    load,
    saveLaunchCommands,
    previewBackground,
    saveBackground,
  }
})
