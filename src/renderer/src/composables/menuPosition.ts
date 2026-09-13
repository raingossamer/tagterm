/**
 * 右键菜单定位（纯函数）：默认在鼠标位置向右下展开；右侧 / 下方放不下时翻转到鼠标左侧 / 上方；仍越界则贴边不为负。
 */
export interface MenuPlacement {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}

export function placeMenu(p: MenuPlacement): { left: number; top: number } {
  const left = p.x + p.width > p.viewportWidth ? Math.max(0, p.x - p.width) : p.x
  const top = p.y + p.height > p.viewportHeight ? Math.max(0, p.y - p.height) : p.y
  return { left, top }
}
