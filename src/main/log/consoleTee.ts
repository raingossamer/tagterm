/**
 * 服务层：接管 console 的四个方法 —— 控制台照常输出，同时抄一份给日志（装配层接到 LogFile 上）。
 * log / info 记 INFO、warn 记 WARN、error 记 ERROR；参数按 console 自己的方式拼成一行（util.format：对象展开、错误带堆栈）。
 * 日志那头出任何错都吞掉，控制台输出不受影响。返回撤销函数（测试用）。不 import electron。
 */
import { format } from 'node:util'
import type { LogLevel } from './LogFile'

export interface ConsoleLike {
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

const METHODS: ReadonlyArray<[method: keyof ConsoleLike, level: LogLevel]> = [
  ['log', 'INFO'],
  ['info', 'INFO'],
  ['warn', 'WARN'],
  ['error', 'ERROR'],
]

export function teeConsole(
  target: ConsoleLike,
  sink: (level: LogLevel, message: string) => void,
): () => void {
  const originals = METHODS.map(([method]) => [method, target[method]] as const)
  for (const [method, level] of METHODS) {
    const original = target[method]
    target[method] = (...args: unknown[]): void => {
      original.apply(target, args)
      try {
        sink(level, format(...args))
      } catch {
        // 日志写不进去不影响控制台
      }
    }
  }
  return () => {
    for (const [method, fn] of originals) target[method] = fn
  }
}
