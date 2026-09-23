import { describe, expect, it } from 'vitest'
import { teeConsole, type ConsoleLike } from '../../src/main/log/consoleTee'

function fakeConsole(): ConsoleLike & { printed: string[][] } {
  const printed: string[][] = []
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      printed.push([name, ...args.map(String)])
    }
  return {
    printed,
    log: record('log'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  }
}

describe('teeConsole（控制台照常输出，同时抄一份给日志）', () => {
  it('log / info 记 INFO、warn 记 WARN、error 记 ERROR；参数按 console 的方式拼成一行（含对象与错误堆栈）；原输出不受影响', () => {
    const c = fakeConsole()
    const sink: Array<[string, string]> = []
    teeConsole(c, (level, message) => sink.push([level, message]))

    c.log('[main] 可用 shell：%s', 'cmd.exe')
    c.info('[pty] 已加载')
    c.warn('[agent] 端口', { port: 56504 })
    c.error('[main] 出错', new Error('boom'))

    expect(c.printed.map((p) => p[0])).toEqual(['log', 'info', 'warn', 'error'])
    expect(sink.map((s) => s[0])).toEqual(['INFO', 'INFO', 'WARN', 'ERROR'])
    expect(sink[0]![1]).toBe('[main] 可用 shell：cmd.exe')
    expect(sink[2]![1]).toBe('[agent] 端口 { port: 56504 }')
    expect(sink[3]![1]).toContain('Error: boom')
    expect(sink[3]![1]).toContain('at ') // 堆栈一并记下
  })

  it('返回的函数撤销接管；日志那头抛错也不影响控制台输出', () => {
    const c = fakeConsole()
    const originalLog = c.log
    const undo = teeConsole(c, () => {
      throw new Error('disk full')
    })
    expect(() => c.log('still printed')).not.toThrow()
    expect(c.printed).toEqual([['log', 'still printed']])
    undo()
    expect(c.log).toBe(originalLog)
  })
})
