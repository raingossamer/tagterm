/**
 * 设置镜像：主进程是真相源，load() 拉取一次并订阅 settings:changed 全量替换；
 * action 只调 SDK，不本地改数据。唤起命令按 pinned / sortOrder 拆成平铺区与「更多」。
 * 全局背景另有一层「预览」：设置弹窗外观段的改动先进预览（整窗即时生效但不落盘），
 * 「保存设置」才提交，「取消」传 null 还原为已保存值。背景图由主进程给 MIME + 字节，这里建成 blob: 对象 URL 镜像
 *（此前是 base64 的 data: URL，渲染进程要多持有两份 2 MB 级的字符串，perf-startup-memory 行为 7），路径变了才重新读、
 * 换图 / 清图时收掉上一个 URL；读不出来（太大、格式不支持）回退纯色并在 imageError 记下原因，一律不抛。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { BackgroundImageData, LaunchCommandInput } from '@shared/ipc'
import type { AppBackground, Settings } from '@shared/models'
import { DEFAULT_BACKGROUND } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import { normalizeLaunchCommands, splitPinned } from '../composables/launchCommands'

/** 主进程给的字节 → 本页面的对象 URL（CSP 放行 img-src blob:）；用完要 revoke，否则字节一直留在渲染进程里 */
function toObjectUrl(image: BackgroundImageData): string {
  return URL.createObjectURL(new Blob([image.bytes], { type: image.mime }))
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({
    launchCommands: [],
    background: DEFAULT_BACKGROUND,
  })
  /** 当前生效背景图的 blob: URL；未设置、文件不存在或读不出来为 null（纯色） */
  const backgroundImage = ref<string | null>(null)
  /** 当前生效背景图读不出来的原因（主进程的中文 message，设置弹窗显示在缩略图下）；读出来了或没设置为空串 */
  const imageError = ref('')
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

  /** 换成新的对象 URL（或 null）：先收掉旧的 */
  function replaceBackgroundUrl(next: string | null): void {
    releaseImageUrl(backgroundImage.value)
    backgroundImage.value = next
  }

  /**
   * 按当前生效背景的 imagePath 同步 blob: URL；路径没变就不重复读（读不出来的同一路径也不重读）。
   * 读不出来回退纯色、记下原因，不抛：启动加载、广播、设置弹窗的「取消」都经过这里，
   * 一张存进去的坏图不能让会话 / 标签整段加载不了，也不能让弹窗关不掉
   */
  async function refreshImage(): Promise<void> {
    const path = background.value.imagePath
    if (path === loadedPath) return
    try {
      const image = path ? await window.tagterm.settings.readBackgroundImage(path) : null
      replaceBackgroundUrl(image ? toObjectUrl(image) : null)
      imageError.value = ''
    } catch (err) {
      replaceBackgroundUrl(null)
      imageError.value = err instanceof Error ? err.message : String(err)
      console.warn(`[settings] 背景图读不出来，已回退纯色：${imageError.value}`)
    }
    loadedPath = path
  }

  /** 外观段预览：传 null 还原为已保存值。换图时会读新图，读不出来回退纯色并记下原因（imageError），不抛 */
  async function previewBackground(next: AppBackground | null): Promise<void> {
    preview.value = next
    await refreshImage()
  }

  async function saveBackground(next: AppBackground): Promise<void> {
    await window.tagterm.settings.update({ background: next })
    preview.value = null
  }

  /**
   * 给设置弹窗的草稿缩略图读一张图（关掉实时预览时整窗仍是已保存的图，弹窗自己看草稿）：另建一个对象 URL，
   * 由调用方用 releaseImageUrl 收掉；文件不存在为 null；读不出来原样抛（弹窗把原因写在缩略图下）
   */
  async function readImageUrl(path: string): Promise<string | null> {
    const image = await window.tagterm.settings.readBackgroundImage(path)
    return image ? toObjectUrl(image) : null
  }

  /** 收掉一个不再用的对象 URL（null 什么都不做） */
  function releaseImageUrl(url: string | null): void {
    if (url) URL.revokeObjectURL(url)
  }

  /** 编辑弹窗「完成」：规整后整体提交 */
  async function saveLaunchCommands(rows: readonly LaunchCommandInput[]): Promise<void> {
    await window.tagterm.settings.update({ launchCommands: normalizeLaunchCommands(rows) })
  }

  return {
    settings,
    backgroundImage,
    imageError,
    background,
    panelOpacity,
    launchCommands,
    pinnedCommands,
    moreCommands,
    load,
    saveLaunchCommands,
    previewBackground,
    saveBackground,
    readImageUrl,
    releaseImageUrl,
  }
})
