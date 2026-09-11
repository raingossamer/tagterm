/**
 * 弹出层开关：打开期间监听 document mousedown，点击容器（按钮 + 弹出层）外部即关闭；
 * 关闭或组件卸载时移除监听。PathStrip 的「更多 ▾」与「+ 标签」共用。
 */
import { onUnmounted, ref, type Ref } from 'vue'

export function usePopover(container: Ref<HTMLElement | null>) {
  const isOpen = ref(false)

  function onDocumentMousedown(e: MouseEvent): void {
    if (!container.value?.contains(e.target as Node)) close()
  }
  function open(): void {
    if (isOpen.value) return
    isOpen.value = true
    document.addEventListener('mousedown', onDocumentMousedown)
  }
  function close(): void {
    isOpen.value = false
    document.removeEventListener('mousedown', onDocumentMousedown)
  }
  function toggle(): void {
    if (isOpen.value) close()
    else open()
  }
  onUnmounted(close)

  return { isOpen, open, close, toggle }
}
