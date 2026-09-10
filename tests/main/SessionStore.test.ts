import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../../src/main/store/SessionStore'
import type { Session } from '@shared/models'

// 用真实临时目录，不 mock fs
describe('SessionStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-store-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('新建会话后可列出，重新加载后仍在，文件为 sessions.json v1 格式', async () => {
    const store = new SessionStore(dir)
    await store.load()
    const created = await store.create({ cwd: 'D:\\Projects\\simba\\api' })
    expect(store.list()).toEqual([created])

    const reloaded = new SessionStore(dir)
    await reloaded.load()
    expect(reloaded.list()).toEqual([created])

    const file = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'))
    expect(file).toEqual({ version: 1, sessions: [created] })
  })

  it('名称缺省取目录末段、shell 缺省 cmd.exe、sortOrder 递增', async () => {
    const store = new SessionStore(dir)
    await store.load()
    const a = await store.create({ cwd: 'D:\\Projects\\simba\\api\\' })
    const b = await store.create({
      cwd: 'C:\\work\\iot',
      name: '  iot-platform ',
      shell: 'powershell.exe',
    })

    expect(a).toMatchObject({ name: 'api', shell: 'cmd.exe', sortOrder: 1 })
    expect(b).toMatchObject({ name: 'iot-platform', shell: 'powershell.exe', sortOrder: 2 })
    expect(new Date(a.createdAt).toISOString()).toBe(a.createdAt)
  })

  it('目录不存在时自动创建，写入后不留 .tmp 残留', async () => {
    const nested = join(dir, 'TagTerm')
    const store = new SessionStore(nested)
    await store.load()
    await store.create({ cwd: 'D:\\x' })

    expect(existsSync(join(nested, 'sessions.json'))).toBe(true)
    expect(readdirSync(nested)).toEqual(['sessions.json'])
  })

  it('坏 JSON 文件加载失败并提示路径，不静默清空', async () => {
    writeFileSync(join(dir, 'sessions.json'), '{ not json', 'utf8')
    const store = new SessionStore(dir)

    await expect(store.load()).rejects.toThrow(join(dir, 'sessions.json'))
  })

  it('更新会话（改名 / 换 shell）后重新加载仍生效', async () => {
    const store = new SessionStore(dir)
    await store.load()
    const s = await store.create({ cwd: 'D:\\x' })
    const updated = await store.update(s.id, { name: 'renamed', shell: 'powershell.exe' })
    expect(updated).toMatchObject({ id: s.id, name: 'renamed', shell: 'powershell.exe' })

    const reloaded = new SessionStore(dir)
    await reloaded.load()
    expect(reloaded.list()[0]).toMatchObject({ name: 'renamed', shell: 'powershell.exe' })
  })

  it('移除会话后列表与文件同时更新；移除不存在的会话报错', async () => {
    const store = new SessionStore(dir)
    await store.load()
    const a = await store.create({ cwd: 'D:\\a' })
    const b = await store.create({ cwd: 'D:\\b' })
    await store.remove(a.id)
    expect(store.list()).toEqual([b])

    const reloaded = new SessionStore(dir)
    await reloaded.load()
    expect(reloaded.list()).toEqual([b])
    await expect(store.remove('missing')).rejects.toThrow('会话不存在')
  })

  it('每次变更后通过 onChanged 回调收到全量列表（供装配层广播）', async () => {
    const received: Session[][] = []
    const store = new SessionStore(dir, { onChanged: (list) => received.push(list) })
    await store.load()
    const a = await store.create({ cwd: 'D:\\a' })
    await store.update(a.id, { name: 'a2' })
    await store.remove(a.id)

    expect(received.map((l) => l.map((s) => s.name))).toEqual([['a'], ['a2'], []])
  })

  it('get 按 id 取会话，不存在则报错；touchOpened 写入 lastOpenedAt 并落盘', async () => {
    const store = new SessionStore(dir)
    await store.load()
    const a = await store.create({ cwd: 'D:\\a' })
    expect(store.get(a.id)).toEqual(a)
    expect(() => store.get('missing')).toThrow('会话不存在')

    await store.touchOpened(a.id)
    const opened = store.get(a.id).lastOpenedAt
    expect(opened).toBeDefined()
    expect(new Date(opened!).toISOString()).toBe(opened)

    const reloaded = new SessionStore(dir)
    await reloaded.load()
    expect(reloaded.get(a.id).lastOpenedAt).toBe(opened)
  })

  it('文件版本高于程序支持的版本时拒绝加载并提示升级', async () => {
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ version: 99, sessions: [] }), 'utf8')
    const store = new SessionStore(dir)

    await expect(store.load()).rejects.toThrow(/版本/)
  })
})
