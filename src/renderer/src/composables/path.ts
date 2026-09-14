/**
 * 路径显示用的纯计算（原型 tail()）：取末两段，兼容结尾反斜杠与正斜杠。
 */
export function pathTail(cwd: string, segments = 2): string {
  return cwd.split(/[\\/]/).filter(Boolean).slice(-segments).join('\\')
}

const ELLIPSIS = '…'

/**
 * 路径条显示用：只保留盘符（或 UNC 前缀）与其后的前 maxSegments 段，更深的层级折成省略号，
 * 避免长路径把路径条撑满（用户 2026-09-14 要求，偏离原型的「显示全路径」）。
 * 完整路径仍在 tooltip 与「复制」里。
 * 例：C:\Users\21477\Desktop\Self-Project\aly-Inform → C:\Users\21477\Desktop\…
 */
export function pathHead(cwd: string, maxSegments = 3): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return cwd
  const prefix = /^[\\/]{2}/.test(cwd) ? '\\\\' : '' // UNC：\\server\share\…
  const [root, ...rest] = parts
  const shown = [root, ...rest.slice(0, maxSegments)].join('\\')
  return prefix + shown + (rest.length > maxSegments ? `\\${ELLIPSIS}` : '')
}
