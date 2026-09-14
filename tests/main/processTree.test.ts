import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { hasChildProcesses } from '../../src/main/processTree'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { waitFor } from './helpers'

describe('processTree.hasChildProcesses', () => {
  it('exec 输出含子进程 pid 行 → true；空输出 → false', async () => {
    await expect(hasChildProcesses(100, async () => '1234\r\n5678\r\n')).resolves.toBe(true)
    await expect(hasChildProcesses(100, async () => '\r\n  \r\n')).resolves.toBe(false)
    await expect(hasChildProcesses(100, async () => '')).resolves.toBe(false)
  })

  it('查询命令按父进程 pid 过滤', async () => {
    const calls: string[][] = []
    await hasChildProcesses(4321, async (file, args) => {
      calls.push([file, ...args])
      return ''
    })
    expect(calls[0]![0]).toMatch(/powershell/i)
    expect(calls[0]!.join(' ')).toContain('ParentProcessId=4321')
  })

  it('exec 失败 → 抛「无法判定终端是否空闲」并带原因', async () => {
    await expect(
      hasChildProcesses(100, async () => {
        throw new Error('powershell 不存在')
      }),
    ).rejects.toThrow(/无法判定终端是否空闲：.*powershell 不存在/)
  })

  // 集成测试：真实 powershell.exe 查真实 cmd.exe（ConPTY）的子进程
  describe('真实 shell', () => {
    const output: Record<string, string> = {}
    let manager: PtyManager | null = null

    afterEach(() => {
      manager?.killAll()
      manager = null
    })

    it('空闲的 cmd.exe 没有子进程；执行 ping 期间有子进程', async () => {
      manager = new PtyManager({
        onData: (id, data) => {
          output[id] = (output[id] ?? '') + data
        },
        onExit: () => {},
        isFile: existsSync,
      })
      const { pid } = manager.spawn('s1', {
        cwd: process.cwd(),
        shell: 'cmd.exe',
        cols: 80,
        rows: 24,
      })
      await waitFor(() => />/.test(output['s1'] ?? ''))
      await expect(hasChildProcesses(pid)).resolves.toBe(false)

      manager.write('s1', 'ping -n 6 127.0.0.1\r')
      await waitFor(
        () => (output['s1'] ?? '').includes('Pinging') || (output['s1'] ?? '').includes('正在'),
      )
      await expect(hasChildProcesses(pid)).resolves.toBe(true)
    }, 30000)
  })
})
