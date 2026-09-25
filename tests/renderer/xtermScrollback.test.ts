import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { CLOSED_TAB_SCROLLBACK, SCROLLBACK } from '../../src/renderer/src/terminal/theme'

/**
 * 守住对 xterm 的假设（升级 xterm 时报警）：关掉的标签页靠「运行时把 scrollback 改小」省内存，
 * 前提是 xterm 改小时立即裁掉最早的行、改回后新输出继续累积。真实 Terminal 不 open() 也能把 write 写进缓冲（happy-dom 下可跑）
 */
const write = (term: Terminal, text: string): Promise<void> =>
  new Promise((resolve) => term.write(text, resolve))
const lines = (from: number, to: number): string =>
  Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\r\n`).join('')

describe('真实 @xterm/xterm：回滚上限运行时可改', () => {
  it('灌 1000 行后把 scrollback 改到 200：缓冲立即缩到 ≤ 200 + rows 且留下的是最后的行；设回 5000 后再灌能累积', async () => {
    const rows = 24
    const term = new Terminal({ scrollback: SCROLLBACK, rows, cols: 80 })
    try {
      await write(term, lines(1, 1000))
      expect(term.buffer.active.length).toBeGreaterThan(1000)

      term.options.scrollback = CLOSED_TAB_SCROLLBACK
      const trimmed = term.buffer.active
      expect(trimmed.length).toBeLessThanOrEqual(CLOSED_TAB_SCROLLBACK + rows)
      // 最后一行是空的当前行，它上面是 line 1000；顶上是被裁后留下的第一行（留下 length - 1 行文字，从末尾往前数）
      expect(trimmed.getLine(trimmed.length - 2)?.translateToString(true)).toBe('line 1000')
      const firstKept = 1000 - (trimmed.length - 1) + 1
      expect(trimmed.getLine(0)?.translateToString(true)).toBe(`line ${firstKept}`)

      term.options.scrollback = SCROLLBACK
      const before = term.buffer.active.length
      await write(term, lines(1001, 1500))
      expect(term.buffer.active.length).toBe(before + 500)
    } finally {
      term.dispose()
    }
  })
})
