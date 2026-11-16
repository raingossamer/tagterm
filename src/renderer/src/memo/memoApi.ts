/**
 * 备忘小窗里的 window.tagterm：小窗有自己的 preload（src/preload/memo.ts），只暴露 memo 与 memoWindow 两组，
 * 形状是 MemoWindowApi 而不是主窗口的 TagTermApi（env.d.ts 按主窗口声明），在这里收窄一次。
 */
import type { MemoWindowApi } from '@shared/api'

export function memoApi(): MemoWindowApi {
  return (window as unknown as { tagterm: MemoWindowApi }).tagterm
}
