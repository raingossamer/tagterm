/**
 * 纯函数：把数据目录路径哈希成一个稳定的动态端口（49152–65535）。
 * 端口稳定，hooks 配置文件里写死的 URL 才不用每次启动都改；被占用时 HookServer 自己 +1 顺延。
 */
export const HOOK_PORT_MIN = 49152
export const HOOK_PORT_MAX = 65535

/** FNV-1a 32 位；输入按小写、统一正斜杠归一，同一目录的两种写法得到同一端口 */
export function derivePort(dataDir: string): number {
  const key = dataDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return HOOK_PORT_MIN + (hash % (HOOK_PORT_MAX - HOOK_PORT_MIN + 1))
}
