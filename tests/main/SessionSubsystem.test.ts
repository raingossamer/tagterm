import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session, Tag } from '@shared/models'
import type { AgentSubsystem } from '../../src/main/agent/AgentSubsystem'
import type { ProcessNode } from '../../src/main/agent/processMatch'
import { PtyManager } from '../../src/main/pty/PtyManager'
import { SessionSubsystem } from '../../src/main/session/SessionSubsystem'
import { SessionStore } from '../../src/main/store/SessionStore'
import { TagStore } from '../../src/main/store/TagStore'
import { FakeConpty } from './fakeConpty'
import { waitFor } from './helpers'
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
  /** 记录式打开目录端口：打开过的路径；openError 非 null 即模拟打不开 */
  let opened: string[]
  let openError: string | null
  /** 假进程树：shell pid → 子进程（有子进程 = 有程序在跑）；queried 记下被查过的 pid */
  let subtrees: Map<number, ProcessNode[]>
  let queried: number[]

  /** 按当前临时目录与假件造一套（模拟重启时再造一次） */
  function build(): SessionSubsystem {
    store = new SessionStore(dir, { onChanged: () => log.push('session:changed') })
    tags = new TagStore(dir, { onChanged: () => log.push('tag:changed') })
    agent = createQuietAgent({
      dir,
      sessions: () => store.list(),
      broadcast: (r) => log.push(r.alive ? 'agent:status' : 'tombstone'),
      listSubtree: async (pid) => {
        queried.push(pid)
        return subtrees.get(pid) ?? []
      },
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
          return openError
        },
      },
    })
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-session-'))
    log.length = 0
    opened = []
    openError = null
    subtrees = new Map()
    queried = []
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

  it('create：建会话后按 tagIds 顺序逐个挂标签、各写各播；中途有不存在的标签原样抛，会话与已挂上的关联保留', async () => {
    const t1 = await tags.create('甲')
    const t2 = await tags.create('乙')
    log.length = 0

    const s = await sessions.create({ cwd: 'D:\\a', tagIds: [t1.id, t2.id] })
    expect(log).toEqual(['session:changed', 'tag:changed', 'tag:changed'])
    expect(tags.list().sessionTags).toEqual([
      { sessionId: s.id, tagId: t1.id },
      { sessionId: s.id, tagId: t2.id },
    ])

    await expect(
      sessions.create({ cwd: 'D:\\b', name: 'partial', tagIds: [t1.id, 'ghost'] }),
    ).rejects.toThrow('标签不存在：ghost')
    const partial = sessions.list().find((x) => x.name === 'partial')
    expect(partial).toBeDefined()
    expect(tags.list().sessionTags).toContainEqual({ sessionId: partial!.id, tagId: t1.id })
  })

  it('remove：结束终端 → 删记录 → 删关联 → 墓碑，全部先于返回；没有关联不写 tags.json；没开过终端不 kill、无墓碑', async () => {
    const t = await tags.create('甲')
    const s = await sessions.create({ cwd: 'D:\\a', tagIds: [t.id] })
    const { pid } = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    log.length = 0

    await sessions.remove(s.id).then(() => log.push('returned'))
    expect(log).toEqual([`kill:${pid}`, 'session:changed', 'tag:changed', 'tombstone', 'returned'])
    expect(sessions.list()).toEqual([])
    expect(tags.list()).toEqual({ tags: [t], sessionTags: [] }) // 标签本身保留

    const plain = await sessions.create({ cwd: 'D:\\b' })
    log.length = 0
    await sessions.remove(plain.id)
    expect(log).toEqual(['session:changed'])
  })

  it('remove：会话不存在只抛「会话不存在」，别的什么都不动', async () => {
    log.length = 0
    await expect(sessions.remove('missing')).rejects.toThrow('会话不存在：missing')
    expect(log).toEqual([])
  })

  it('remove：tags.json 写不进去时原样抛，停在删记录之后、不回滚；下次加载清掉残留关联且不广播', async () => {
    const t = await tags.create('甲')
    const s = await sessions.create({ cwd: 'D:\\a', tagIds: [t.id] })
    const tagsFile = join(dir, 'tags.json')
    chmodSync(tagsFile, 0o444) // 只读：原子写最后一步 rename 覆盖它时 EPERM，原内容保留
    log.length = 0
    try {
      await expect(sessions.remove(s.id)).rejects.toThrow(/EPERM/)
    } finally {
      chmodSync(tagsFile, 0o666)
    }
    expect(log).toEqual(['session:changed']) // 没有 tag:changed，也没有墓碑
    expect(sessions.list()).toEqual([])
    // 写失败的那一步不领先于文件：TagStore 内存里关联还在（渲染进程以会话列表内连接，看不见它）
    expect(tags.list().sessionTags).toEqual([{ sessionId: s.id, tagId: t.id }])

    log.length = 0
    await build().load()
    expect(tags.list().sessionTags).toEqual([])
    expect(log).toEqual([])
  })

  it('attachTag 先核对会话存在（不存在抛「会话不存在」且不写 tags.json）；detachTag 不核对会话', async () => {
    const t = await tags.create('甲')
    const s = await sessions.create({ cwd: 'D:\\a' })
    const tagsFile = join(dir, 'tags.json')
    const fileBefore = readFileSync(tagsFile, 'utf8')
    log.length = 0

    await expect(sessions.attachTag('missing', t.id)).rejects.toThrow('会话不存在：missing')
    expect(readFileSync(tagsFile, 'utf8')).toBe(fileBefore)
    expect(log).toEqual([])

    await sessions.attachTag(s.id, t.id)
    expect(tags.list().sessionTags).toEqual([{ sessionId: s.id, tagId: t.id }])

    await expect(sessions.detachTag('missing', t.id)).resolves.toBeUndefined()
    await sessions.detachTag(s.id, t.id)
    expect(tags.list().sessionTags).toEqual([])
  })

  it('update：只改名 / 同值补丁 / 终端没在跑 → 不查进程树、不结束终端；会话不存在抛「会话不存在」', async () => {
    const s = await sessions.create({ cwd: 'D:\\a' })
    await sessions.update(s.id, { cwd: 'D:\\b' }) // 终端没在跑：直接改
    expect(sessions.list()[0]!.cwd).toBe('D:\\b')

    const { pid } = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    subtrees.set(pid, [{ pid: pid + 1, ppid: pid, name: 'ping.exe' }]) // 有程序在跑也不该被查到
    log.length = 0
    expect((await sessions.update(s.id, { name: '改名' })).name).toBe('改名')
    await sessions.update(s.id, { cwd: 'D:\\b', shell: 'cmd.exe' }) // 同值不算改
    expect(queried).toEqual([])
    expect(log).toEqual(['session:changed', 'session:changed'])
    expect(sessions.isTerminalAlive(s.id)).toBe(true)

    await expect(sessions.update('missing', { name: 'x' })).rejects.toThrow('会话不存在：missing')
  })

  it('update：改目录 / Shell 时终端里有程序在跑 → 原文案拒绝，记录、终端、文件都不动', async () => {
    const s = await sessions.create({ cwd: 'D:\\a' })
    const { pid } = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    subtrees.set(pid, [{ pid: pid + 1, ppid: pid, name: 'ping.exe' }])
    const fileBefore = readFileSync(join(dir, 'sessions.json'), 'utf8')
    log.length = 0

    await expect(sessions.update(s.id, { shell: 'powershell.exe' })).rejects.toThrow(
      '终端里有程序正在运行，退出后再修改目录或 Shell',
    )
    expect(queried).toEqual([pid])
    expect(log).toEqual([])
    expect(sessions.isTerminalAlive(s.id)).toBe(true)
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).toBe(fileBefore)
  })

  it('update：改目录且终端空闲 → 先结束终端、等 pty:exit 广播出去再写记录，最后返回；再开终端按新目录起', async () => {
    const s = await sessions.create({ cwd: 'D:\\a' })
    const { pid } = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    const fileBefore = readFileSync(join(dir, 'sessions.json'), 'utf8')
    log.length = 0

    const updating = sessions.update(s.id, { cwd: 'D:\\b' }).then((next) => {
      log.push('returned')
      return next
    })
    await flush()
    expect(log).toEqual([`kill:${pid}`])
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).toBe(fileBefore) // exit 没到：记录不动

    conpty.exit(pid)
    expect((await updating).cwd).toBe('D:\\b')
    expect(log).toEqual([`kill:${pid}`, 'pty:exit', 'tombstone', 'session:changed', 'returned'])

    const again = sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    expect(again.created).toBe(true)
    expect(conpty.spawns.at(-1)!.options.cwd).toBe('D:\\b')
  })

  it('openDirectory：打开运行时的当前目录（没有则固定目录）；打不开抛「打不开目录：原因」；会话不存在不碰端口', async () => {
    const s = await sessions.create({ cwd: 'D:\\a' })
    await sessions.openDirectory(s.id)
    expect(opened).toEqual(['D:\\a'])

    sessions.openTerminal(s.id, { cols: 80, rows: 24 })
    sessions.reportOutput(s.id, { tail: ['C:\\Windows>'], silentMs: 1500 }) // 终端里 cd 到了别处
    await sessions.openDirectory(s.id)
    expect(opened).toEqual(['D:\\a', 'C:\\Windows'])

    openError = '找不到路径'
    await expect(sessions.openDirectory(s.id)).rejects.toThrow('打不开目录：找不到路径')

    await expect(sessions.openDirectory('missing')).rejects.toThrow('会话不存在：missing')
    expect(opened).toHaveLength(3)
  })
})

// 集成：真 ConPTY（不注入 spawnPty），仍用假进程树、不起 HookServer —— 守「改目录时 pty:exit 先于返回」在真实终端上成立
describe('SessionSubsystem 集成（真 ConPTY）', () => {
  it('空闲 cmd 改目录：返回时 pty:exit 已广播、终端已结束；再开起在新目录', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tagterm-session-it-'))
    const output: Record<string, string> = {}
    const exits: string[] = []
    const store = new SessionStore(dir)
    const agent = createQuietAgent({ dir, sessions: () => store.list(), broadcast: () => {} })
    const pty = new PtyManager(
      agent.wrapPty({
        onData: (id, data) => {
          output[id] = (output[id] ?? '') + data
        },
        onExit: (e) => exits.push(e.sessionId),
        isFile: existsSync,
      }),
    )
    const sessions = new SessionSubsystem({
      store,
      tags: new TagStore(dir),
      terminals: pty,
      agent,
      folders: { open: async () => null },
    })
    try {
      await sessions.load()
      const s = await sessions.create({ cwd: process.cwd() })
      sessions.openTerminal(s.id, { cols: 80, rows: 24 })
      await waitFor(() => />/.test(output[s.id] ?? ''))

      const target = join(process.cwd(), 'tests')
      expect((await sessions.update(s.id, { cwd: target })).cwd).toBe(target)
      expect(exits).toContain(s.id)
      expect(sessions.isTerminalAlive(s.id)).toBe(false)

      output[s.id] = ''
      expect(sessions.openTerminal(s.id, { cols: 80, rows: 24 }).created).toBe(true)
      await waitFor(() => (output[s.id] ?? '').includes('tests>'))
    } finally {
      pty.killAll()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
