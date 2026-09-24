/**
 * 应用内确认弹窗的请求（取代 window.confirm）：ask 挂出一条请求并返回 Promise<boolean>，
 * App 挂载的 ConfirmDialog 显示它、用户作答后 answer 兑现。
 * 不用原生 window.confirm：Electron 在 Windows 上原生对话框关掉后，窗口与 webContents 都以为自己有焦点，
 * 页面却没有（document.hasFocus() 为 false），之后点输入框没反应，要切走窗口再切回来才好。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ConfirmRequest {
  /** 问句（可多行） */
  message: string
  /** 「确定」是破坏性动作（删除、移除、结束程序）：按钮用红字 */
  danger: boolean
}

export const useConfirmStore = defineStore('confirm', () => {
  const request = ref<ConfirmRequest | null>(null)
  let settle: ((ok: boolean) => void) | null = null

  /** 同时只有一条：新的请求顶掉还没作答的旧请求，旧的按取消处理 */
  function ask(message: string, options: { danger?: boolean } = {}): Promise<boolean> {
    settle?.(false)
    request.value = { message, danger: options.danger ?? false }
    return new Promise((resolve) => {
      settle = resolve
    })
  }

  /** 作答并收起；没有请求时什么都不做 */
  function answer(ok: boolean): void {
    const resolve = settle
    settle = null
    request.value = null
    resolve?.(ok)
  }

  return { request, ask, answer }
})
