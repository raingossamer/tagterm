/**
 * 终端字号（纯函数）：本机偏好的解析，以及 Ctrl+滚轮的步数换算。
 * 字号全部终端共用一份，存 localStorage；Ctrl+0 回到默认。范围与夹紧在 shared/fontSize（主进程校验导入的配置文件也用），
 * 这里原样再导出给终端侧
 */
import { clampFontSize, DEFAULT_FONT_SIZE } from '@shared/fontSize'

export { clampFontSize, DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '@shared/fontSize'

/** localStorage 里存的字号：只认纯数字串，缺失或坏值回落默认 */
export function parseFontSize(raw: string | null): number {
  if (raw === null || !/^\d+(\.\d+)?$/.test(raw.trim())) return DEFAULT_FONT_SIZE
  return clampFontSize(Number(raw))
}

/** 鼠标滚轮一格的像素量（Chromium 在 Windows 上一格报 deltaY = 100） */
const WHEEL_STEP_PX = 100
/** deltaMode 1（按行）一格约 3 行 */
const LINE_PX = WHEEL_STEP_PX / 3

export interface WheelZoom {
  /** 送入一次 Ctrl+滚轮的 deltaY 与 deltaMode，返回字号该变几步（往上滚为正 = 变大） */
  push(deltaY: number, deltaMode: number): number
}

/**
 * 滚轮增量累积器：鼠标一格一步；触摸板（双指捏合在 Windows 上也是 Ctrl+滚轮）每次只给几个像素，
 * 攒够一格才变一步，余数留给下一次；反向滚动先抵消余数
 */
export function createWheelZoom(): WheelZoom {
  let pending = 0
  return {
    push(deltaY, deltaMode) {
      const px =
        deltaMode === 2
          ? Math.sign(deltaY) * WHEEL_STEP_PX
          : deltaMode === 1
            ? deltaY * LINE_PX
            : deltaY
      pending -= px
      const steps = Math.trunc(pending / WHEEL_STEP_PX)
      pending -= steps * WHEEL_STEP_PX
      return steps
    },
  }
}
