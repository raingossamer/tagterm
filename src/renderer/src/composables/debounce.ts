/**
 * 尾部防抖（纯工厂）：连续调用只在安静 waitMs 之后执行一次，期间的调用全部合并。
 * 用处见 TerminalPane：ResizeObserver 在拖动窗口时逐帧回调，而每次 fit 都要重排终端缓冲区
 * 并把新尺寸同步给 ConPTY（Windows 上较慢），逐帧执行会卡顿并闪烁；停下来再算一次即可。
 */
export interface Debounced {
  /** 触发一次：重新开始计时 */
  call: () => void
  /** 取消尚未执行的那次（组件卸载时调用） */
  cancel: () => void
}

export function createDebounced(fn: () => void, waitMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return {
    call(): void {
      clear()
      timer = setTimeout(() => {
        timer = null
        fn()
      }, waitMs)
    },
    cancel: clear,
  }
}
