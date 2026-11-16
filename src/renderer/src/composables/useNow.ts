/**
 * 「现在」的响应式时钟：备忘小窗一开可能好几天，「本周」不能停在打开那一刻。
 * 每分钟走一次，窗口重新拿到焦点时也立即刷新；卸载时清掉定时器与监听。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

export const NOW_TICK_MS = 60_000

export function useNow(): Ref<Date> {
  const now = ref(new Date())
  const refresh = (): void => {
    now.value = new Date()
  }
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    timer = setInterval(refresh, NOW_TICK_MS)
    window.addEventListener('focus', refresh)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
    window.removeEventListener('focus', refresh)
  })
  return now
}
