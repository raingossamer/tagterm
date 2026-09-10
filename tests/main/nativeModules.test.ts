import { describe, expect, it } from 'vitest'
import * as nodePty from 'node-pty'

// 环境烟测：证明 node-pty 的预编译原生模块能加载，且 ConPTY 能起 cmd.exe（Slice 1 验收项）
describe('node-pty 原生模块', () => {
  it('能加载并通过 ConPTY 启动 cmd.exe 得到输出', async () => {
    const term = nodePty.spawn('cmd.exe', ['/c', 'echo tagterm-ok'], {
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    })
    let output = ''
    term.onData((d) => {
      output += d
    })
    const exitCode = await new Promise<number>((resolve) => term.onExit((e) => resolve(e.exitCode)))

    expect(exitCode).toBe(0)
    expect(output).toContain('tagterm-ok')
  })
})
