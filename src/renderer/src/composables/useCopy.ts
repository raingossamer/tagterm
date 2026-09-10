/**
 * 复制文本到剪贴板，并给出 1.2 s 的「已复制」反馈（原型行为）。
 */
import { ref } from 'vue'

const FEEDBACK_MS = 1200

export function useCopy() {
  const isCopied = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function copy(text: string): Promise<void> {
    await navigator.clipboard?.writeText(text)
    isCopied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      isCopied.value = false
    }, FEEDBACK_MS)
  }

  return { isCopied, copy }
}
