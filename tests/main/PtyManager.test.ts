import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PtyExitEvent } from '@shared/ipc'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { buildSpawnSpec } from '../../src/main/pty/shellArgs'
import { FakeConpty } from './fakeConpty'
import { waitFor } from './helpers'

// 集成测试：起真实 cmd.exe（ConPTY）
describe('PtyManager', () => {
  const output: Record<string, string> = {}
  const exits: PtyExitEvent[] = []
  const spawns: Array<[sessionId: string, pid: number]> = []
  let manager: PtyManager

  function createManager(): PtyManager {
    manager = new PtyManager({
      onData: (id, data) => {
        output[id] = (output[id] ?? '') + data
      },
      onExit: (e) => exits.push(e),
      onSpawn: (id, pid) => spawns.push([id, pid]),
      isFile: existsSync,
    })
    return manager
  }

  afterEach(() => {
    manager?.killAll()
    exits.length = 0
    spawns.length = 0
    for (const k of Object.keys(output)) delete output[k]
  })

  it('spawn 后写入 echo 能收到输出；resize 不抛；kill 触发 onExit 并从池中移除', async () => {
    const pm = createManager()
    const { pid } = pm.spawn('s1', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })
    expect(pid).toBeGreaterThan(0)
    expect(pm.has('s1')).toBe(true)
    expect(spawns).toEqual([['s1', pid]]) // 装配层靠它把 spawn 接给 AgentDetector

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

  it('kill 后 exit 还没来时再 kill（含 killAll）一律忽略：node-pty 只被 kill 一次，exit 事件只来一次', async () => {
    const pm = createManager()
    pm.spawn('twice', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })
    pm.kill('twice')
    pm.kill('twice')
    pm.killAll()
    await waitFor(() => exits.some((e) => e.sessionId === 'twice'))
    await new Promise((r) => setTimeout(r, 200))
    expect(exits.filter((e) => e.sessionId === 'twice')).toHaveLength(1)
    expect(pm.has('twice')).toBe(false)
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

  it('主进程工作目录是 System32 时也能起 cmd.exe（开机自启由注册表 Run 项拉起时就是这个工作目录）', async () => {
    // node-pty 对相对名 cmd.exe 会先看当前目录：System32 里正好有一个，它的 get_shell_path 反而返回空串并抛
    // 「File not found: 」。修法是传绝对路径；这里把进程工作目录真切到 System32 复现那个场景，结束后切回
    const original = process.cwd()
    process.chdir(join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32'))
    try {
      const pm = createManager()
      pm.spawn('boot', { cwd: original, shell: 'cmd.exe', cols: 80, rows: 24 })
      pm.write('boot', 'echo tagterm-boot\r')
      await waitFor(() => (output['boot'] ?? '').includes('tagterm-boot'))
    } finally {
      process.chdir(original)
    }
  })
})

// 测试注入口：node-pty 是真外部依赖，换成假 ConPTY 后 PtyManager 自己的逻辑照跑（不起真实进程）
describe('PtyManager 注入 spawnPty', () => {
  let pm: PtyManager | undefined
  afterEach(() => pm?.killAll())

  it('用注入的 spawnPty 起终端，参数与缺省路径一致；送达退出后回调 onExit、条目删除', () => {
    const conpty = new FakeConpty()
    const exits: PtyExitEvent[] = []
    pm = new PtyManager({
      onData: () => {},
      onExit: (e) => exits.push(e),
      isFile: existsSync,
      spawnPty: conpty.spawn,
    })

    const { pid } = pm.spawn('s1', { cwd: process.cwd(), shell: 'cmd.exe', cols: 90, rows: 30 })
    const spec = buildSpawnSpec('cmd.exe', process.cwd(), process.env, existsSync)
    expect(conpty.spawns).toHaveLength(1)
    // env 不整份比较：断言失败时 diff 会把本机全部环境变量（可能含密钥）打进测试输出，只核对追加的 LANG
    const { env, ...options } = conpty.spawns[0]!.options
    expect({ ...conpty.spawns[0], options }).toEqual({
      pid,
      file: spec.file,
      commandLine: spec.commandLine,
      options: { name: 'xterm-256color', cwd: process.cwd(), cols: 90, rows: 30, useConpty: true },
    })
    expect(env?.['LANG']).toBe('zh_CN.UTF-8')
    expect(pm.getPid('s1')).toBe(pid)

    conpty.exit(pid, 3)
    expect(exits).toEqual([{ sessionId: 's1', exitCode: 3, pid }])
    expect(pm.has('s1')).toBe(false)
  })
})
