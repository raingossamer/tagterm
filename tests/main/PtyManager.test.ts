import { afterEach, describe, expect, it } from 'vitest'
import type { PtyExitEvent } from '@shared/ipc'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { waitFor } from './helpers'

// 集成测试：起真实 cmd.exe（ConPTY）
describe('PtyManager', () => {
  const output: Record<string, string> = {}
  const exits: PtyExitEvent[] = []
  let manager: PtyManager

  function createManager(): PtyManager {
    manager = new PtyManager({
      onData: (id, data) => {
        output[id] = (output[id] ?? '') + data
      },
      onExit: (e) => exits.push(e),
    })
    return manager
  }

  afterEach(() => {
    manager?.killAll()
    exits.length = 0
    for (const k of Object.keys(output)) delete output[k]
  })

  it('spawn 后写入 echo 能收到输出；resize 不抛；kill 触发 onExit 并从池中移除', async () => {
    const pm = createManager()
    const { pid } = pm.spawn('s1', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })
    expect(pid).toBeGreaterThan(0)
    expect(pm.has('s1')).toBe(true)

    pm.write('s1', 'echo tagterm-ok\r')
    await waitFor(() => (output['s1'] ?? '').includes('tagterm-ok'))

    expect(() => pm.resize('s1', 100, 30)).not.toThrow()

    pm.kill('s1')
    await waitFor(() => exits.some((e) => e.sessionId === 's1'))
    expect(pm.has('s1')).toBe(false)
  })

  it('killAll 结束全部会话，之后 has() 全为 false', async () => {
    const pm = createManager()
    pm.spawn('a', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })
    pm.spawn('b', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })

    pm.killAll()
    await waitFor(() => exits.length === 2)
    expect(pm.has('a')).toBe(false)
    expect(pm.has('b')).toBe(false)
  })

  it('killAndWait 在 exit 回调触发后才 resolve；未运行的会话立即 resolve', async () => {
    const pm = createManager()
    pm.spawn('w', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })

    await pm.killAndWait('w')
    expect(exits.some((e) => e.sessionId === 'w')).toBe(true)
    expect(pm.has('w')).toBe(false)

    await expect(pm.killAndWait('nope')).resolves.toBeUndefined()
  })

  it('重复 spawn 同一会话报错；对不存在的会话 write / resize / kill 忽略不抛', () => {
    const pm = createManager()
    pm.spawn('dup', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })
    expect(() =>
      pm.spawn('dup', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 }),
    ).toThrow(/已在运行/)

    expect(() => pm.write('nope', 'x')).not.toThrow()
    expect(() => pm.resize('nope', 1, 1)).not.toThrow()
    expect(() => pm.kill('nope')).not.toThrow()
  })
})
