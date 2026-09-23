/**
 * 点击冷却：启动外部程序 / 打开外部窗口的控件用（规范「组件风格」）—— 双击不该得到两个资源管理器窗口。
 * 距上次生效的点击不足 ms 毫秒的点击直接忽略，被忽略的点击不重置冷却；用时间戳比对、不挂定时器，组件卸载无需清理。
 * 返回的函数每次点击调一次：true = 放行。现有使用：路径 chip（打开当前目录）、设置「关于」的「打开日志目录」
 */
export function createCooldown(ms: number, now: () => number = () => Date.now()): () => boolean {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < ms) return false
    last = t
    return true
  }
}
