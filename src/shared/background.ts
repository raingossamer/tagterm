/**
 * 全局背景四个参数（显示方式、背景 / 面板不透明度、模糊）的合法性（两进程共用的纯函数）：
 * 接口层 settings:update 的守卫与配置文件的解析用同一套规则、同一句中文。imagePath 不在此查。
 */
import { BACKGROUND_FITS, MAX_BLUR_PX, MIN_PANEL_OPACITY, type BackgroundFit } from './models'

/** 不合法时返回原因，合法返回 null */
export function describeBackgroundParamsError(o: Record<string, unknown>): string | null {
  if (!BACKGROUND_FITS.includes(o.fit as BackgroundFit)) {
    return `不支持的显示方式：${String(o.fit)}`
  }
  if (typeof o.imageOpacity !== 'number' || !(o.imageOpacity >= 0 && o.imageOpacity <= 1)) {
    return '背景不透明度必须在 0 到 1 之间'
  }
  if (
    typeof o.panelOpacity !== 'number' ||
    !(o.panelOpacity >= MIN_PANEL_OPACITY && o.panelOpacity <= 1)
  ) {
    return `面板不透明度必须在 ${MIN_PANEL_OPACITY} 到 1 之间`
  }
  if (
    !Number.isInteger(o.blurPx) ||
    (o.blurPx as number) < 0 ||
    (o.blurPx as number) > MAX_BLUR_PX
  ) {
    return `背景模糊必须是 0 到 ${MAX_BLUR_PX} 之间的整数`
  }
  return null
}
