/**
 * 页面可见性的响应式镜像：窗口藏到托盘或最小化时 Chromium 把 document.hidden 置真，重新显示时置假（被别的窗口挡住不算）。
 * 挂载时读初值（开机自启藏在托盘时挂载，初值就是不可见），visibilitychange 更新，卸载移除监听。
 * App 据此在窗口看不见时关掉可见终端的 WebGL（释放上下文与字形图集，GPU 进程省几十 MB），重新可见时再开，
 * 期间 DOM 渲染兜着不会空白（perf-startup-memory 行为 6）
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

export function useDocumentVisible(): Ref<boolean> {
  const isVisible = ref(!document.hidden)
  const update = (): void => {
    isVisible.value = !document.hidden
  }
  onMounted(() => {
    update()
    document.addEventListener('visibilitychange', update)
  })
  onUnmounted(() => document.removeEventListener('visibilitychange', update))
  return isVisible
}
