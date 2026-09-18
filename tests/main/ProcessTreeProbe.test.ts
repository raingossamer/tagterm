import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentKind } from '@shared/models'
import { afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { ProcessTreeProbe } from '../../src/main/agent/ProcessTreeProbe'
import type { ProcessNode } from '../../src/main/agent/processMatch'
import { listSubtree } from '../../src/main/agent/windowsProcessTree'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { waitFor } from './helpers'

// 定时排程与快照去重经 AgentSubsystem 的边界测试覆盖；这里只留空闲核对与真实原生模块的集成用例
describe('ProcessTreeProbe（pty 子树查询）', () => {
  /** 假子树：pid → 子进程列表；假定时器：手动触发 */
  let subtrees: Map<number, ProcessNode[]>
  let pending: Array<() => void>
  let snapshots: Array<Map<string, AgentKind | null>>
  let probe: ProcessTreeProbe

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  async function tick(): Promise<void> {
    const fns = pending.splice(0)
    for (const fn of fns) fn()
    await flush()
  }

  beforeEach(() => {
    subtrees = new Map()
    pending = []
    snapshots = []
    probe = new ProcessTreeProbe({
      listSubtree: async (pid) => subtrees.get(pid) ?? [],
      intervalMs: 2000,
      setTimer: (fn) => {
        pending.push(fn)
        return fn
      },
      clearTimer: (handle) => {
        const i = pending.indexOf(handle as () => void)
        if (i >= 0) pending.splice(i, 1)
      },
    })
    probe.onSnapshot((s) => snapshots.push(s))
  })

  it('hasChildren：子树非空为真、空为假；listSubtree 抛错时该会话按无 agent 处理、其他会话不受影响', async () => {
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'ping.exe' }])
    await expect(probe.hasChildren(100)).resolves.toBe(true)
    await expect(probe.hasChildren(999)).resolves.toBe(false)

    const failing = new ProcessTreeProbe({
      listSubtree: async (pid) => {
        if (pid === 100) throw new Error('boom')
        return [{ pid: 201, ppid: 200, name: 'claude.exe' }]
      },
      intervalMs: 2000,
      setTimer: (fn) => {
        pending.push(fn)
        return 0
      },
      clearTimer: () => {},
    })
    failing.onSnapshot((s) => snapshots.push(s))
    failing.watch('s1', 100)
    failing.watch('s2', 200)
    await tick()
    expect(snapshots[0]).toEqual(
      new Map<string, AgentKind | null>([
        ['s1', null],
        ['s2', 'claude'],
      ]),
    )
  })

  // 集成测试：真实原生模块查真实 cmd.exe（ConPTY）的子树（替代原 PowerShell 版 processTree 的集成测试）
  describe('真实 shell（@vscode/windows-process-tree）', () => {
    const output: Record<string, string> = {}
    let manager: PtyManager | null = null

    afterEach(() => {
      manager?.killAll()
      manager = null
    })

    it('空闲的 cmd.exe 没有子进程；执行 ping 期间有子进程且子树里能看到 PING.EXE；不存在的 pid 为空', async () => {
      manager = new PtyManager({
        onData: (id, data) => {
          output[id] = (output[id] ?? '') + data
        },
        onExit: () => {},
        isFile: existsSync,
      })
      const real = new ProcessTreeProbe({ listSubtree, intervalMs: 2000 })
      const { pid } = manager.spawn('s1', {
        cwd: process.cwd(),
        shell: 'cmd.exe',
        cols: 80,
        rows: 24,
      })
      await waitFor(() => />/.test(output['s1'] ?? ''))
      await expect(real.hasChildren(pid)).resolves.toBe(false)

      manager.write('s1', 'ping -n 6 127.0.0.1\r')
      await waitFor(
        () => (output['s1'] ?? '').includes('Pinging') || (output['s1'] ?? '').includes('正在'),
      )
      await expect(real.hasChildren(pid)).resolves.toBe(true)
      const names = (await listSubtree(pid)).map((p) => p.name.toLowerCase())
      expect(names).toContain('ping.exe')
      expect(names).not.toContain('cmd.exe')

      await expect(listSubtree(2 ** 30)).resolves.toEqual([])
    }, 30000)
  })
})
