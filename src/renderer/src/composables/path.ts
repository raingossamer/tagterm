/**
 * 路径显示用的纯计算（原型 tail()）：取末两段，兼容结尾反斜杠与正斜杠。
 */
export function pathTail(cwd: string, segments = 2): string {
  return cwd.split(/[\\/]/).filter(Boolean).slice(-segments).join('\\')
}
