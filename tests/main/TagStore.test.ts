import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

    const recolored = await store.update(b.id, { color: '#D14343', sortOrder: 9 })
    expect(recolored).toEqual({ ...b, color: '#D14343', sortOrder: 9 })
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
})
