import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session, Tag } from '@shared/models'
import type { AgentSubsystem } from '../../src/main/agent/AgentSubsystem'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { SessionSubsystem } from '../../src/main/session/SessionSubsystem'
import { SessionStore } from '../../src/main/store/SessionStore'
import { TagStore } from '../../src/main/store/TagStore'
import { FakeConpty } from './fakeConpty'
import { createQuietAgent } from './quietAgent'

function sessionRecord(id: string): Session {
  return {
    id,
    name: id,
    cwd: 'D:\\a',
    shell: 'cmd.exe',
    sortOrder: 1,
    createdAt: '2026-09-24T00:00:00.000Z',
  }
}

function tagRecord(id: string): Tag {
  return { id, name: id, color: '#2F6FDB', sortOrder: 1 }
}

/** 让已排队的回调与微任务都跑完 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * 边界测试：与生产同一条装配（真 store + 临时目录、真 PtyManager 经 agent.wrapPty 接线、真 AgentSubsystem），
 * 只替换真外部依赖 —— node-pty（假 ConPTY）、进程树（假子树）、打开目录（记录式端口）。
 * 广播、ConPTY 的 kill 与 pty 退出记进同一条有序日志，断言因果顺序；不起 ConPTY、不起 HookServer。
 */
describe('SessionSubsystem（主进程会话编排子系统）', () => {
  let dir: string
  /** 有序日志：session:changed / tag:changed / agent:status / tombstone（记录删除）/ pty:exit / kill:<pid> */
  const log: string[] = []
  let conpty: FakeConpty
  let store: SessionStore
  let tags: TagStore
  let agent: AgentSubsystem
  let sessions: SessionSubsystem
  let opened: string[]

  /** 按当前临时目录与假件造一套（模拟重启时再造一次） */
  function build(): SessionSubsystem {
    store = new SessionStore(dir, { onChanged: () => log.push('session:changed') })
    tags = new TagStore(dir, { onChanged: () => log.push('tag:changed') })
    agent = createQuietAgent({
      dir,
      sessions: () => store.list(),
      broadcast: (r) => log.push(r.alive ? 'agent:status' : 'tombstone'),
    })
    const pty = new PtyManager(
      agent.wrapPty({
        onData: () => {},
        onExit: () => log.push('pty:exit'),
        isFile: () => true,
        spawnPty: conpty.spawn,
      }),
    )
    return new SessionSubsystem({
      store,
      tags,
      terminals: pty,
      agent,
      folders: {
        open: async (path) => {
          opened.push(path)
          return null
        },
      },
    })
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-session-'))
    log.length = 0
    opened = []
    conpty = new FakeConpty(log)
    sessions = build()
    await sessions.load()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('load：两份文件都加载后才清掉悬空的会话标签关联，落盘但不广播', async () => {
    writeFileSync(
      join(dir, 'sessions.json'),
      JSON.stringify({ version: 1, sessions: [sessionRecord('s1')] }),
    )
    writeFileSync(
      join(dir, 'tags.json'),
      JSON.stringify({
        version: 1,
        tags: [tagRecord('t1')],
        sessionTags: [
          { sessionId: 's1', tagId: 't1' },
          { sessionId: 'ghost', tagId: 't1' },
          { sessionId: 's1', tagId: 'ghost' },
        ],
      }),
    )
    log.length = 0

    await build().load()

    const kept = [{ sessionId: 's1', tagId: 't1' }]
    expect(tags.list().sessionTags).toEqual(kept)
    expect(JSON.parse(readFileSync(join(dir, 'tags.json'), 'utf8')).sessionTags).toEqual(kept)
    expect(log).toEqual([])
  })

  it('load：sessions.json 坏了带路径抛出，文件原样不动（不静默重置为空）', async () => {
    const file = join(dir, 'sessions.json')
    writeFileSync(file, '{ 坏的')

    await expect(build().load()).rejects.toThrow(file)
    expect(readFileSync(file, 'utf8')).toBe('{ 坏的')
  })

  it('openTerminal：按记录的目录与 shell 起终端；重复打开复用同一个、不写盘不广播；退出后再开是新的', async () => {
    const s = await store.create({ cwd: 'D:\\work', shell: 'powershell.exe' })
    const fileBefore = readFileSync(join(dir, 'sessions.json'), 'utf8')
    log.length = 0

    const first = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    expect(first.created).toBe(true)
    expect(conpty.spawns).toHaveLength(1)
    const spawned = conpty.spawns[0]!
    expect(spawned.pid).toBe(first.pid)
    expect(spawned.options.cwd).toBe('D:\\work')
    expect([spawned.options.cols, spawned.options.rows]).toEqual([80, 24])
    expect(spawned.commandLine).toContain('-NoExit') // powershell 的启动参数，cmd 是 /k

    expect(sessions.openTerminal(s.id, { cols: 80, rows: 24 })).toEqual({
      created: false,
      pid: first.pid,
    })
    expect(conpty.spawns).toHaveLength(1)
    expect(log).not.toContain('session:changed')
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).toBe(fileBefore)

    conpty.exit(first.pid)
    const again = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    expect(again.created).toBe(true)
    expect(again.pid).not.toBe(first.pid)
  })

  it('openTerminal：会话不存在抛「会话不存在」，不起终端', () => {
    expect(() => sessions.openTerminal('missing', { cols: 80, rows: 24 })).toThrow(
      '会话不存在：missing',
    )
    expect(conpty.spawns).toHaveLength(0)
  })

  it('killTerminal：等 pty 真正退出（pty:exit 先广播）才返回；退出前再调不会第二次结束进程；没在跑立即返回', async () => {
    const s = await store.create({ cwd: 'D:\\a' })
    const { pid } = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    log.length = 0

    const first = sessions.killTerminal(s.id).then(() => log.push('returned'))
    // kill 与 exit 之间再调一次：假 ConPTY 对同一句柄二次 kill 即抛（真 ConPTY 会原生崩溃）
    const second = sessions.killTerminal(s.id).then(() => log.push('returned-again'))
    await flush()
    expect(log).toEqual([`kill:${pid}`])
    expect(sessions.isTerminalAlive(s.id)).toBe(true)

    conpty.exit(pid)
    await Promise.all([first, second])
    expect(log).toEqual([`kill:${pid}`, 'pty:exit', 'tombstone', 'returned', 'returned-again'])
    expect(sessions.isTerminalAlive(s.id)).toBe(false)
    await expect(sessions.killTerminal(s.id)).resolves.toBeUndefined()
  })

  it('reportOutput：已知会话交给运行时（当前目录跟着提示符走）；记录已不在的会话静默丢弃', async () => {
    const kept = await store.create({ cwd: 'D:\\a' })
    const gone = await store.create({ cwd: 'D:\\b' })
    sessions.openTerminal(kept.id, { cols: 80, rows: 24 })
    sessions.openTerminal(gone.id, { cols: 80, rows: 24 })
    await store.remove(gone.id) // 记录没了、pty 还没退：运行时记录仍在，报告也不能再推动它
    log.length = 0

    sessions.reportOutput(gone.id, { tail: ['C:\\Windows>'], silentMs: 1500 })
    expect(log).toEqual([])

    sessions.reportOutput(kept.id, { tail: ['C:\\Windows>'], silentMs: 1500 })
    expect(log).toEqual(['agent:status'])
    expect(agent.list().find((r) => r.sessionId === kept.id)?.cwdNow).toBe('C:\\Windows')
  })

  it('list / reorder / writeTerminal / resizeTerminal 原样转发：排列不合法照旧拒绝；没在跑的终端写入与改尺寸静默忽略', async () => {
    const a = await store.create({ cwd: 'D:\\a' })
    const b = await store.create({ cwd: 'D:\\b' })
    await sessions.reorder([b.id, a.id])
    expect(sessions.list().map((s) => s.id)).toEqual([b.id, a.id])
    await expect(sessions.reorder([a.id])).rejects.toThrow('排序参数必须是全部会话 id 的一个排列')

    const { pid } = sessions.openTerminal(a.id, { cols: 80, rows: 24 })
    sessions.writeTerminal(a.id, 'dir\r')
    sessions.resizeTerminal(a.id, { cols: 100, rows: 40 })
    expect(conpty.writes).toEqual([[pid, 'dir\r']])
    expect(conpty.resizes).toEqual([[pid, 100, 40]])

    expect(() => sessions.writeTerminal(b.id, 'x')).not.toThrow()
    expect(() => sessions.resizeTerminal(b.id, { cols: 1, rows: 1 })).not.toThrow()
    expect(conpty.writes).toHaveLength(1)
  })
})
