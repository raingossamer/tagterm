import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookAgent } from '@shared/ipc'
import type { Session, SessionRuntime } from '@shared/models'
import {
  AgentSubsystem,
  derivePort,
  type AgentSubsystemOptions,
  type NotificationText,
} from '../../src/main/agent/AgentSubsystem'
import type { ProcessNode } from '../../src/main/agent/processMatch'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { waitFor } from './helpers'

/** 模拟 hooks 里的 curl：把载荷 POST 到子系统的回环端点，返回状态码 */
function postHook(port: number, agent: HookAgent, payload: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: `/tagterm/hook/${agent}`, method: 'POST' },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify(payload))
  })
}

function sessionOf(id: string, cwd: string): Session {
  return {
    id,
    name: `${id}-name`,
    cwd,
    shell: 'cmd.exe',
    sortOrder: 1,
    createdAt: '2026-09-18T00:00:00Z',
  }
}

/**
 * 边界测试：只经 AgentSubsystem 的公共接口与注入的假件（broadcast 数组、假子树、假定时器 / 时钟）断言，
 * 不碰 AgentDetector / ProcessTreeProbe 等内部协作者。
 */
describe('AgentSubsystem（主进程 agent 运行时子系统）', () => {
  let changes: SessionRuntime[]
  let sessions: Session[]
  let subtrees: Map<number, ProcessNode[]>
  let queried: number[]
  let pending: Array<() => void>
  let now: number
  let dir: string
  let agent: AgentSubsystem
  let pty: PtyManager | null
  /** 假通知中心：记录弹过的通知；isSupported 可切换 */
  let shown: Array<[sessionId: string, text: NotificationText]>
  let isNotificationSupported: boolean
  /** 假角标：记录每次收到的「等你确认」计数 */
  let badges: number[]
  /** 再造一个子系统时复用同一套假件（端口测试要多个实例） */
  let baseOptions: AgentSubsystemOptions

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  /** 触发一轮探针扫描（假定时器） */
  async function tick(): Promise<void> {
    const fns = pending.splice(0)
    for (const fn of fns) fn()
    await flush()
  }
  const runtimeOf = (id: string): SessionRuntime | undefined =>
    agent.list().find((r) => r.sessionId === id)

  beforeEach(() => {
    changes = []
    sessions = []
    subtrees = new Map()
    queried = []
    pending = []
    now = 1_000_000
    pty = null
    shown = []
    isNotificationSupported = true
    badges = []
    dir = mkdtempSync(join(tmpdir(), 'tagterm-agent-'))
    baseOptions = {
      dataDir: dir,
      sessions: () => sessions,
      broadcast: (r) => changes.push(r),
      notifications: {
        isSupported: () => isNotificationSupported,
        show: (sessionId, text) => shown.push([sessionId, text]),
      },
      badge: { setBlockedCount: (count) => badges.push(count) },
      hookTargets: {
        claude: {
          agent: 'claude',
          settingsPath: join(dir, 'claude-settings.json'),
          createIfMissing: false,
        },
        codex: {
          agent: 'codex',
          settingsPath: join(dir, 'codex-hooks.json'),
          createIfMissing: true,
        },
      },
      listSubtree: async (pid) => {
        queried.push(pid)
        return subtrees.get(pid) ?? []
      },
      now: () => now,
      timers: {
        setTimer: (fn) => {
          pending.push(fn)
          return fn
        },
        clearTimer: (handle) => {
          const i = pending.indexOf(handle as () => void)
          if (i >= 0) pending.splice(i, 1)
        },
      },
      preferredPort: 0, // 随机端口：测试不用数据目录哈希
    }
    agent = new AgentSubsystem(baseOptions)
  })

  afterEach(async () => {
    pty?.killAll()
    await agent.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('wrapPty 接上真 PtyManager：spawn 后出现空闲记录并开始探测该 pid；退出后先调用方 onExit、再墓碑广播，探针不再查询', async () => {
    const events: string[] = []
    pty = new PtyManager(
      agent.wrapPty({
        onData: () => {},
        onExit: (e) => {
          events.push(`exit:${e.sessionId}`)
          // 调用方的 onExit 先于状态机：此时记录还在
          expect(runtimeOf(e.sessionId)).toBeDefined()
        },
        isFile: existsSync,
      }),
    )
    const { pid } = pty.spawn('s1', { cwd: process.cwd(), shell: 'cmd.exe', cols: 80, rows: 24 })
    expect(runtimeOf('s1')).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
    expect(changes).toEqual([{ sessionId: 's1', alive: true, agent: null, status: 'idle' }])

    await tick()
    expect(queried).toEqual([pid])

    await pty.killAndWait('s1')
    await waitFor(() => changes.length === 2)
    expect(events).toEqual(['exit:s1'])
    expect(changes[1]).toEqual({ sessionId: 's1', alive: false, agent: null, status: 'idle' })
    expect(agent.list()).toEqual([])

    await tick()
    expect(queried).toEqual([pid]) // 探针已停：没有下一轮
  })

  it('进程树发现 claude → 记 agent；随后有输出到达 → working；工具退出（子树清空）→ idle 且不留提示', async () => {
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    wrapped.onSpawn?.('s1', 100)
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'claude.exe' }])
    await tick()
    expect(runtimeOf('s1')).toMatchObject({ agent: 'claude', status: 'idle' })

    wrapped.onData('s1', 'x')
    expect(runtimeOf('s1')).toMatchObject({ agent: 'claude', status: 'working' })
    expect(changes.at(-1)).toMatchObject({ sessionId: 's1', status: 'working' })

    subtrees.set(100, [])
    await tick()
    expect(runtimeOf('s1')).toEqual({ sessionId: 's1', alive: true, agent: null, status: 'idle' })
  })

  it('静默末尾报告不再带 shell：无 agent 只更新 cwdNow；有 agent 末行提示 → blocked + 提示；跑完 → done，被查看 → idle；会话移除 → 墓碑', async () => {
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    wrapped.onSpawn?.('s1', 100)
    agent.reportOutput('s1', { tail: ['Allow execution?', 'PS C:\\repo>'], silentMs: 1500 })
    expect(runtimeOf('s1')).toEqual({
      sessionId: 's1',
      alive: true,
      agent: null,
      status: 'idle',
      cwdNow: 'C:\\repo',
    })

    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'codex.exe' }])
    await tick()
    wrapped.onData('s1', 'x')
    agent.reportOutput('s1', { tail: ['Do you want to proceed? (y/n)'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({
      status: 'blocked',
      pendingHint: 'Do you want to proceed? (y/n)',
    })

    wrapped.onData('s1', 'y')
    agent.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({ status: 'done' })
    agent.setViewed('s1')
    expect(runtimeOf('s1')).toMatchObject({ status: 'idle' })
    expect(runtimeOf('s1')).not.toHaveProperty('pendingHint')

    agent.reportOutput('ghost', { tail: ['Allow?'], silentMs: 1500 }) // 未知会话忽略
    const count = changes.length
    agent.sessionRemoved('s1')
    expect(agent.list()).toEqual([])
    expect(changes).toHaveLength(count + 1)
    expect(changes.at(-1)).toEqual({ sessionId: 's1', alive: false, agent: null, status: 'idle' })
  })

  it('isShellIdle：有子进程为假、没有为真；查询抛错（pid 已不存在）按空闲处理而不是把原生错误抛出去', async () => {
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'ping.exe' }])
    await expect(agent.isShellIdle(100)).resolves.toBe(false)
    await expect(agent.isShellIdle(200)).resolves.toBe(true)

    const failing = new AgentSubsystem({
      ...baseOptions,
      listSubtree: async () => {
        throw new Error('boom')
      },
    })
    await expect(failing.isShellIdle(100)).resolves.toBe(true)
    await failing.stop()
  })

  it('start 后收 hooks：按 cwd 命中会话（归一化）→ 转移，不命中 → 无变化；hook 后 30 s 内启发式不转移；Stop 被查看 → idle，否则 → done', async () => {
    const api = 'D:\\repo\\api'
    sessions.push(sessionOf('s1', api), sessionOf('s2', 'D:\\repo\\web'))
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    wrapped.onSpawn?.('s1', 100)
    wrapped.onSpawn?.('s2', 200)
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'claude.exe' }])
    await tick()

    await agent.start()
    expect(agent.port).toBeGreaterThan(0)

    expect(
      await postHook(agent.port, 'claude', {
        hook_event_name: 'Notification',
        cwd: 'd:/repo/api/',
        notification_type: 'permission_prompt',
        message: 'x',
      }),
    ).toBe(204)
    await waitFor(() => runtimeOf('s1')?.status === 'blocked')
    expect(runtimeOf('s1')).toMatchObject({ agent: 'claude', status: 'blocked', pendingHint: 'x' })
    expect(runtimeOf('s2')).toMatchObject({ status: 'idle' })

    const count = changes.length
    expect(
      await postHook(agent.port, 'claude', {
        hook_event_name: 'UserPromptSubmit',
        cwd: 'D:\\elsewhere',
      }),
    ).toBe(204)
    await new Promise((r) => setTimeout(r, 50))
    expect(changes).toHaveLength(count)

    // 抑制窗：30 s 内静默报告不转移（cwdNow 照常更新），30 s 后恢复
    agent.reportOutput('s1', { tail: ['C:\\now>'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({ status: 'blocked', cwdNow: 'C:\\now' })
    now += 31_000
    agent.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({ status: 'done' })

    agent.setViewed('s1')
    expect(runtimeOf('s1')).toMatchObject({ status: 'idle' })
    await postHook(agent.port, 'claude', { hook_event_name: 'UserPromptSubmit', cwd: api })
    await waitFor(() => runtimeOf('s1')?.status === 'working')
    await postHook(agent.port, 'claude', { hook_event_name: 'Stop', cwd: api })
    await waitFor(() => runtimeOf('s1')?.status === 'idle')

    agent.setViewed(null)
    await postHook(agent.port, 'claude', { hook_event_name: 'UserPromptSubmit', cwd: api })
    await postHook(agent.port, 'claude', { hook_event_name: 'Stop', cwd: api })
    await waitFor(() => runtimeOf('s1')?.status === 'done')
  })

  it('首选端口被占 → 顺延，启动前装好的 hooks 命令被静默改成实际端口；全部端口都失败 → port 为 0、start 不抛、已装文件不改写', async () => {
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const taken = (blocker.address() as { port: number }).port
    const codexFile = join(dir, 'codex-hooks.json')
    const claudeFile = join(dir, 'claude-settings.json')
    writeFileSync(claudeFile, JSON.stringify({ model: 'opus' }))
    try {
      // 顺延：端口从 taken 起被占，落到别的端口；装在端口 0 上的命令随之改写
      const moved = new AgentSubsystem({ ...baseOptions, preferredPort: taken })
      await expect(moved.setHooks('codex', true)).resolves.toMatchObject({
        installed: true,
        port: 0,
      })
      await moved.start()
      expect(moved.port).toBeGreaterThan(0)
      expect(moved.port).not.toBe(taken)
      const status = await moved.hooksStatus()
      expect(status.codex).toEqual({ installed: true, port: moved.port, settingsPath: codexFile })
      expect(status.claude).toEqual({
        installed: false,
        port: moved.port,
        settingsPath: claudeFile,
      })
      expect(readFileSync(codexFile, 'utf8')).toContain(`127.0.0.1:${moved.port}/`)
      await moved.stop()

      // 全部失败：只试一个端口且被占 → 端口 0，不抛；已装在端口 0 的 Claude 文件原样不动
      const failed = new AgentSubsystem({
        ...baseOptions,
        preferredPort: taken,
        maxPortAttempts: 1,
      })
      await expect(failed.setHooks('claude', true)).resolves.toMatchObject({ installed: true })
      const before = readFileSync(claudeFile, 'utf8')
      await expect(failed.start()).resolves.toBeUndefined()
      expect(failed.port).toBe(0)
      expect(readFileSync(claudeFile, 'utf8')).toBe(before)
      const after = await failed.hooksStatus()
      expect(after.claude).toMatchObject({ installed: true, port: 0 })
      expect(after.codex).toMatchObject({ installed: true }) // 上一个实例装的仍在文件里
      await failed.stop()
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()))
    }
  })

  it('hooks 开关往返：Codex 目标可新建、卸载后骨架保留；Claude 目标缺文件时安装 reject 中文 message、状态带 error', async () => {
    await agent.start()
    const codexFile = join(dir, 'codex-hooks.json')
    await expect(agent.setHooks('codex', true)).resolves.toEqual({
      installed: true,
      port: agent.port,
      settingsPath: codexFile,
    })
    await expect(agent.setHooks('codex', false)).resolves.toEqual({
      installed: false,
      port: agent.port,
      settingsPath: codexFile,
    })
    expect(JSON.parse(readFileSync(codexFile, 'utf8'))).toEqual({ hooks: {} })

    await expect(agent.setHooks('claude', true)).rejects.toThrow('未找到 Claude Code 配置文件')
    const status = await agent.hooksStatus()
    expect(status.claude).toMatchObject({
      installed: false,
      error: expect.stringContaining('未找到'),
    })
    expect(status.codex).toEqual({ installed: false, port: agent.port, settingsPath: codexFile })
  })

  it('系统通知：未查看进入 blocked → 「<名> 等你确认」一次，同状态不重复、正被查看不弹；未查看跑完 → 「<名> 完成」，被查看跑完不弹；通知中心不可用一律不弹', async () => {
    sessions.push(sessionOf('s1', 'D:/a'))
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    wrapped.onSpawn?.('s1', 100)
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'claude.exe' }])
    await tick()
    wrapped.onData('s1', 'x')
    expect(shown).toEqual([])

    const ask = { tail: ['Do you want to proceed? (y/n)'], silentMs: 1500 }
    agent.reportOutput('s1', ask)
    expect(shown).toEqual([
      ['s1', { title: 's1-name 等你确认', body: 'Do you want to proceed? (y/n)' }],
    ])
    agent.reportOutput('s1', ask) // 同状态再报：不重复弹
    expect(shown).toHaveLength(1)

    // 正被查看时进入 blocked：不弹
    wrapped.onData('s1', 'y')
    agent.setViewed('s1')
    agent.reportOutput('s1', ask)
    expect(runtimeOf('s1')).toMatchObject({ status: 'blocked' })
    expect(shown).toHaveLength(1)

    // 没人看着跑完 → 「完成」；被查看后回空闲不弹
    agent.setViewed(null)
    agent.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({ status: 'done' })
    expect(shown.at(-1)).toEqual(['s1', { title: 's1-name 完成', body: '' }])
    agent.setViewed('s1')
    expect(shown).toHaveLength(2)

    // 正被查看时跑完 → idle，不弹
    wrapped.onData('s1', 'x')
    agent.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({ status: 'idle' })
    expect(shown).toHaveLength(2)

    // 通知中心不可用：进入 blocked 也不弹；找不到会话名时用 id
    isNotificationSupported = false
    agent.setViewed(null)
    wrapped.onData('s1', 'x')
    agent.reportOutput('s1', ask)
    expect(runtimeOf('s1')).toMatchObject({ status: 'blocked' })
    expect(shown).toHaveLength(2)
  })

  it('角标 = 等你确认的会话数：两个会话先后 blocked → 1、2；一个被查看回空闲 → 1；记录删除 → 0；计数没变不重复设置', async () => {
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    wrapped.onSpawn?.('s1', 100)
    wrapped.onSpawn?.('s2', 200)
    subtrees.set(100, [{ pid: 101, ppid: 100, name: 'claude.exe' }])
    subtrees.set(200, [{ pid: 201, ppid: 200, name: 'codex.exe' }])
    await tick()
    wrapped.onData('s1', 'x')
    wrapped.onData('s2', 'x')
    expect(badges).toEqual([]) // 还没有人等确认：不设置

    const ask = { tail: ['Allow?'], silentMs: 1500 }
    agent.reportOutput('s1', ask)
    agent.reportOutput('s2', ask)
    expect(badges).toEqual([1, 2])
    agent.reportOutput('s2', ask) // 同状态再报：计数没变
    expect(badges).toEqual([1, 2])

    agent.setViewed('s1')
    agent.reportOutput('s1', { tail: ['Done.'], silentMs: 1500 })
    expect(runtimeOf('s1')).toMatchObject({ status: 'idle' })
    expect(badges).toEqual([1, 2, 1])

    wrapped.onExit({ sessionId: 's2', exitCode: 0, pid: 200 })
    expect(badges).toEqual([1, 2, 1, 0])
  })

  it('同一目录多个会话都命中时：优先 agent 已是该工具的会话；没有可区分的就全部转移', async () => {
    const cwd = 'D:/same'
    sessions.push(sessionOf('s1', cwd), sessionOf('s2', cwd), sessionOf('s3', cwd))
    const wrapped = agent.wrapPty({ onData: () => {}, onExit: () => {}, isFile: existsSync })
    for (const [id, pid] of [
      ['s1', 100],
      ['s2', 200],
      ['s3', 300],
    ] as const) {
      wrapped.onSpawn?.(id, pid)
    }
    subtrees.set(200, [{ pid: 201, ppid: 200, name: 'claude.exe' }])
    await tick()
    await agent.start()

    await postHook(agent.port, 'claude', { hook_event_name: 'UserPromptSubmit', cwd })
    await waitFor(() => runtimeOf('s2')?.status === 'working')
    expect(runtimeOf('s1')).toMatchObject({ status: 'idle' })
    expect(runtimeOf('s3')).toMatchObject({ status: 'idle' })

    // 没有会话在 codex 里：SessionStart 落到全部命中的会话上
    await postHook(agent.port, 'codex', { hook_event_name: 'SessionStart', cwd })
    await waitFor(() => runtimeOf('s3')?.agent === 'codex')
    expect(runtimeOf('s1')).toMatchObject({ agent: 'codex' })
  })

  it('端点首选端口由数据目录派生：同一目录的两种写法得到同一端口，落在 49152–65535', () => {
    const a = derivePort('C:/Users/k/AppData/Roaming/TagTerm')
    expect(derivePort('c:\\users\\k\\appdata\\roaming\\tagterm\\')).toBe(a)
    expect(a).toBeGreaterThanOrEqual(49152)
    expect(a).toBeLessThanOrEqual(65535)
    expect(derivePort('D:/elsewhere')).not.toBe(a)
  })
})
