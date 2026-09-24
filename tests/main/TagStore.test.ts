import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TagStore } from '../../src/main/store/TagStore'
import type { TagListResult } from '@shared/ipc'

// 用真实临时目录，不 mock fs
describe('TagStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-tags-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('无文件时为空集合；create 分配 uuid、按八色表轮转颜色、sortOrder 递增；落盘 tags.json v1，重新加载一致', async () => {
    const store = new TagStore(dir)
    await store.load()
    expect(store.list()).toEqual({ tags: [], sessionTags: [] })

    const a = await store.create('simba')
    const b = await store.create(' java ')
    expect(a).toMatchObject({ name: 'simba', color: '#2F6FDB', sortOrder: 1 })
    expect(b).toMatchObject({ name: 'java', color: '#2A9D5C', sortOrder: 2 })
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.id).not.toBe(b.id)

    const file = JSON.parse(readFileSync(join(dir, 'tags.json'), 'utf8'))
    expect(file).toEqual({ version: 1, tags: [a, b], sessionTags: [] })

    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list()).toEqual(store.list())
  })

  it('create 同名（trim 后精确匹配、区分大小写）返回已有标签，不新建；空名报错', async () => {
    const store = new TagStore(dir)
    await store.load()
    const a = await store.create('simba')

    await expect(store.create('  simba ')).resolves.toEqual(a)
    expect(store.list().tags).toHaveLength(1)
    const upper = await store.create('Simba')
    expect(upper.id).not.toBe(a.id)
    expect(store.list().tags).toHaveLength(2)

    await expect(store.create('   ')).rejects.toThrow('标签名不能为空')
  })

  it('update：改名 / 换色 / 排序；改名撞名报错、空名报错、非法颜色拒绝、不存在报错', async () => {
    const store = new TagStore(dir)
    await store.load()
    const a = await store.create('simba')
    const b = await store.create('java')

    const renamed = await store.update(a.id, { name: ' simba-2 ' })
    expect(renamed).toEqual({ ...a, name: 'simba-2' })
    await expect(store.update(a.id, { name: 'simba-2' })).resolves.toEqual(renamed) // 同名自身不算撞名
    await expect(store.update(a.id, { name: ' java ' })).rejects.toThrow('已有同名标签：java')
    await expect(store.update(a.id, { name: '' })).rejects.toThrow('标签名不能为空')

    const recolored = await store.update(b.id, { color: '#D14343' })
    expect(recolored).toEqual({ ...b, color: '#D14343' })
    await expect(store.update(b.id, { color: '#000000' as never })).rejects.toThrow(
      '不支持的颜色：#000000',
    )
    await expect(store.update('nope', { name: 'x' })).rejects.toThrow('标签不存在：nope')

    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list().tags).toEqual([renamed, recolored])
  })

  it('attach 幂等且要求标签存在；detach 移除关联；detachAllOf 清掉某会话全部关联；remove 标签连带其关联', async () => {
    const store = new TagStore(dir)
    await store.load()
    const a = await store.create('simba')
    const b = await store.create('java')

    await store.attach('s1', a.id)
    await store.attach('s1', a.id)
    await store.attach('s1', b.id)
    await store.attach('s2', a.id)
    expect(store.list().sessionTags).toEqual([
      { sessionId: 's1', tagId: a.id },
      { sessionId: 's1', tagId: b.id },
      { sessionId: 's2', tagId: a.id },
    ])
    await expect(store.attach('s1', 'nope')).rejects.toThrow('标签不存在：nope')

    await store.detach('s1', b.id)
    await store.detach('s1', b.id) // 不存在的关联静默
    expect(store.list().sessionTags).toEqual([
      { sessionId: 's1', tagId: a.id },
      { sessionId: 's2', tagId: a.id },
    ])

    await store.attach('s2', b.id)
    await store.detachAllOf('s2')
    expect(store.list().sessionTags).toEqual([{ sessionId: 's1', tagId: a.id }])

    await store.attach('s3', a.id)
    await store.remove(a.id)
    expect(store.list()).toEqual({ tags: [b], sessionTags: [] })
    await expect(store.remove(a.id)).rejects.toThrow(`标签不存在：${a.id}`)

    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list()).toEqual({ tags: [b], sessionTags: [] })
  })

  it('update({ hidden }) 落盘规则：true 写 "hidden": true，false 删键（可选字段缺省不写）', async () => {
    const store = new TagStore(dir)
    await store.load()
    const a = await store.create('simba')
    expect(a.hidden).toBeUndefined()

    const hidden = await store.update(a.id, { hidden: true })
    expect(hidden).toEqual({ ...a, hidden: true })
    let file = JSON.parse(readFileSync(join(dir, 'tags.json'), 'utf8'))
    expect(file.tags[0]).toHaveProperty('hidden', true)

    const shown = await store.update(a.id, { hidden: false })
    expect(shown).toEqual(a) // 无 hidden 键
    expect(shown).not.toHaveProperty('hidden')
    file = JSON.parse(readFileSync(join(dir, 'tags.json'), 'utf8'))
    expect(file.tags[0]).not.toHaveProperty('hidden')

    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list().tags[0]).not.toHaveProperty('hidden')
  })

  it('reorder(ids) 按位置写 sortOrder 1..n，一次落盘一次回调；ids 不是全部标签的排列则拒绝、不落盘', async () => {
    const received: TagListResult[] = []
    const store = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await store.load()
    const a = await store.create('a') // sortOrder 1
    const b = await store.create('b') // 2
    const c = await store.create('c') // 3
    received.length = 0

    await store.reorder([c.id, a.id, b.id])
    expect(store.list().tags).toEqual([
      { ...c, sortOrder: 1 },
      { ...a, sortOrder: 2 },
      { ...b, sortOrder: 3 },
    ])
    expect(received).toHaveLength(1) // 一次原子写一次广播

    // 缺、多、重复、含不存在的 id 都拒绝，且不改动
    const snapshot = store.list().tags
    await expect(store.reorder([a.id, b.id])).rejects.toThrow(/排列/)
    await expect(store.reorder([a.id, b.id, c.id, 'ghost'])).rejects.toThrow(/排列/)
    await expect(store.reorder([a.id, a.id, b.id])).rejects.toThrow(/排列/)
    expect(store.list().tags).toEqual(snapshot)
    expect(received).toHaveLength(1) // 拒绝的调用不落盘不广播

    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list().tags.map((t) => t.name)).toEqual(['c', 'a', 'b'])
  })

  it('pruneDangling 清掉指向不存在会话或标签的关联并落盘，返回条数，不回调 onChanged', async () => {
    const received: unknown[] = []
    const store = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await store.load()
    const a = await store.create('simba')
    await store.attach('s1', a.id)
    await store.attach('s2', a.id)
    // 模拟崩溃留下的悬空标签引用：直接改文件
    const file = join(dir, 'tags.json')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.sessionTags.push({ sessionId: 's1', tagId: 'ghost' })
    writeFileSync(file, JSON.stringify(raw), 'utf8')

    const fresh = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await fresh.load()
    received.length = 0
    await expect(fresh.pruneDangling(['s1'])).resolves.toBe(2)
    expect(fresh.list().sessionTags).toEqual([{ sessionId: 's1', tagId: a.id }])
    expect(received).toEqual([])
    await expect(fresh.pruneDangling(['s1'])).resolves.toBe(0)

    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list().sessionTags).toEqual([{ sessionId: 's1', tagId: a.id }])
  })

  it('格式不正确 / 版本过高 / 坏 JSON 的文件拒绝加载并提示路径，不静默重置', async () => {
    const file = join(dir, 'tags.json')
    writeFileSync(file, JSON.stringify({ version: 1, tags: [] }), 'utf8')
    await expect(new TagStore(dir).load()).rejects.toThrow(file)

    writeFileSync(file, JSON.stringify({ version: 99, tags: [], sessionTags: [] }), 'utf8')
    await expect(new TagStore(dir).load()).rejects.toThrow(/版本/)

    writeFileSync(file, '{ not json', 'utf8')
    await expect(new TagStore(dir).load()).rejects.toThrow(file)
  })

  it('每次变更落盘后回调全量 { tags, sessionTags }', async () => {
    const received: TagListResult[] = []
    const store = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await store.load()
    const a = await store.create('simba')
    await store.create('simba') // 幂等：不落盘不回调
    await store.attach('s1', a.id)
    await store.update(a.id, { color: '#D14343' })
    await store.remove(a.id)

    expect(received.map((r) => [r.tags.length, r.sessionTags.length])).toEqual([
      [1, 0],
      [1, 1],
      [1, 1],
      [0, 0],
    ])
    expect(received[2]).toEqual({
      tags: [{ ...a, color: '#D14343' }],
      sessionTags: [{ sessionId: 's1', tagId: a.id }],
    })
  })

  it('写盘失败：内存保持改之前、不回调、原样抛；之后别的变更落盘也不会把失败的改动带进文件', async () => {
    const received: TagListResult[] = []
    const store = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await store.load()
    const a = await store.create('甲')
    const b = await store.create('乙')
    await store.attach('s1', a.id)
    const before = store.list()
    received.length = 0
    const file = join(dir, 'tags.json')
    chmodSync(file, 0o444) // 只读：原子写最后一步 rename 覆盖它时 EPERM，原内容保留
    try {
      await expect(store.create('丙')).rejects.toThrow(/EPERM/)
      await expect(store.update(a.id, { name: '甲甲', color: '#D14343' })).rejects.toThrow(/EPERM/)
      await expect(store.reorder([b.id, a.id])).rejects.toThrow(/EPERM/)
      await expect(store.attach('s2', b.id)).rejects.toThrow(/EPERM/)
      await expect(store.detach('s1', a.id)).rejects.toThrow(/EPERM/)
      await expect(store.detachAllOf('s1')).rejects.toThrow(/EPERM/)
      await expect(store.pruneDangling([])).rejects.toThrow(/EPERM/)
      await expect(store.remove(a.id)).rejects.toThrow(/EPERM/)
    } finally {
      chmodSync(file, 0o666)
    }
    expect(store.list()).toEqual(before)
    expect(received).toEqual([])

    await store.update(b.id, { hidden: true })
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.tags.map((t: { name: string }) => t.name)).toEqual(['甲', '乙'])
    expect(saved.sessionTags).toEqual([{ sessionId: 's1', tagId: a.id }])
  })

  it('并发的变更排队执行、互不覆盖：同时给会话挂两个标签、同时新建两个标签，内存与文件里都齐全', async () => {
    const store = new TagStore(dir)
    await store.load()
    const [a, b] = await Promise.all([store.create('甲'), store.create('乙')])
    expect([a.sortOrder, b.sortOrder]).toEqual([1, 2])
    expect(a.color).not.toBe(b.color)
    await Promise.all([store.attach('s1', a.id), store.attach('s1', b.id)])

    expect(store.list().sessionTags).toEqual([
      { sessionId: 's1', tagId: a.id },
      { sessionId: 's1', tagId: b.id },
    ])
    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list()).toEqual(store.list())
  })

  it('并发新建同名标签只建一个：排在后面的按前一个提交后的数据判定，返回已有的', async () => {
    const store = new TagStore(dir)
    await store.load()
    const [a, b] = await Promise.all([store.create('甲'), store.create(' 甲 ')])
    expect(b).toEqual(a)
    expect(store.list().tags).toEqual([a])
  })

  it('importByName：按名合并 —— 同名沿用本机标签（id 与关联不动，颜色 / 隐藏用给的），没有的新建；给的在前、本机独有的接在后；一次写一次回调', async () => {
    const received: TagListResult[] = []
    const store = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await store.load()
    const java = await store.create('java', '#C98A0C')
    const old = await store.create('old', '#6B7280')
    await store.update(old.id, { hidden: true })
    await store.attach('s1', java.id)
    received.length = 0

    const result = await store.importByName([
      { name: 'simba', color: '#2F6FDB' },
      { name: 'java', color: '#2A9D5C', hidden: true },
    ])
    expect(result).toEqual({ created: 1, updated: 1, changed: true })
    const { tags, sessionTags } = store.list()
    expect(tags.map((t) => [t.name, t.color, t.hidden ?? false, t.sortOrder])).toEqual([
      ['simba', '#2F6FDB', false, 1],
      ['java', '#2A9D5C', true, 2],
      ['old', '#6B7280', true, 3],
    ])
    expect(tags[1]!.id).toBe(java.id)
    expect(sessionTags).toEqual([{ sessionId: 's1', tagId: java.id }])
    expect(received).toHaveLength(1)

    const reloaded = new TagStore(dir)
    await reloaded.load()
    expect(reloaded.list()).toEqual(store.list())
  })

  it('importByName：与本机完全相同（同名同色同隐藏、同顺序）时不写盘不回调，返回全 0', async () => {
    const received: TagListResult[] = []
    const store = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await store.load()
    await store.create('a', '#2F6FDB')
    await store.create('b', '#2A9D5C')
    received.length = 0
    const file = join(dir, 'tags.json')
    const before = readFileSync(file, 'utf8')

    await expect(
      store.importByName([
        { name: 'a', color: '#2F6FDB' },
        { name: 'b', color: '#2A9D5C' },
      ]),
    ).resolves.toEqual({ created: 0, updated: 0, changed: false })
    expect(received).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('importByName：本机 sortOrder 有空洞（删过标签）时导入同一份内容仍算未变；只有先后不同时写盘、计数为 0 而 changed 为 true；换色计 updated、与位置无关', async () => {
    const received: TagListResult[] = []
    const store = new TagStore(dir, { onChanged: (r) => received.push(r) })
    await store.load()
    await store.create('a', '#2F6FDB')
    const b = await store.create('b', '#2A9D5C')
    await store.create('c', '#C98A0C')
    await store.remove(b.id) // 本机剩 a(sortOrder 1)、c(3)
    received.length = 0
    const file = join(dir, 'tags.json')
    const before = readFileSync(file, 'utf8')

    await expect(
      store.importByName([
        { name: 'a', color: '#2F6FDB' },
        { name: 'c', color: '#C98A0C' },
      ]),
    ).resolves.toEqual({ created: 0, updated: 0, changed: false })
    expect(received).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(before)

    await expect(
      store.importByName([
        { name: 'c', color: '#C98A0C' },
        { name: 'a', color: '#2F6FDB' },
      ]),
    ).resolves.toEqual({ created: 0, updated: 0, changed: true })
    expect(store.list().tags.map((t) => [t.name, t.sortOrder])).toEqual([
      ['c', 1],
      ['a', 2],
    ])
    expect(received).toHaveLength(1)

    await expect(
      store.importByName([
        { name: 'c', color: '#D14343' },
        { name: 'a', color: '#2F6FDB' },
      ]),
    ).resolves.toEqual({ created: 0, updated: 1, changed: true })
  })
})
