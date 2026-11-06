import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoStore } from '../../src/main/store/MemoStore'
import type { MemoItem } from '@shared/models'

// 用真实临时目录，不 mock fs
describe('MemoStore', () => {
  let dir: string
  let clock: Date
  const now = (): Date => clock
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-memo-'))
    clock = new Date('2026-11-06T02:00:00.000Z')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function open(onChanged?: (items: MemoItem[]) => void): Promise<MemoStore> {
    const store = new MemoStore(dir, { now, onChanged })
    await store.load()
    return store
  }

  it('文件不存在为空；新建的事项去掉首尾空白、未完成、带创建时间，落盘为 memo.json v1 并回调全量', async () => {
    const changes: MemoItem[][] = []
    const store = await open((items) => changes.push(items))
    expect(store.list()).toEqual([])

    const item = await store.create('  写周报 ')

    expect(item).toEqual({
      id: expect.any(String),
      text: '写周报',
      done: false,
      createdAt: '2026-11-06T02:00:00.000Z',
    })
    expect(store.list()).toEqual([item])
    expect(changes).toEqual([[item]])
    expect(JSON.parse(readFileSync(join(dir, 'memo.json'), 'utf8'))).toEqual({
      version: 1,
      items: [item],
    })
    const reloaded = await open()
    expect(reloaded.list()).toEqual([item])
  })

  it('勾选完成由主进程写完成时间；再勾一次不改原时间；取消勾选删掉 doneAt 键', async () => {
    const store = await open()
    const item = await store.create('买菜')

    clock = new Date('2026-11-07T03:00:00.000Z')
    const done = await store.update(item.id, { done: true })
    expect(done).toMatchObject({ done: true, doneAt: '2026-11-07T03:00:00.000Z' })

    clock = new Date('2026-11-08T03:00:00.000Z')
    expect((await store.update(item.id, { done: true })).doneAt).toBe('2026-11-07T03:00:00.000Z')

    const reopened = await store.update(item.id, { done: false })
    expect(reopened.done).toBe(false)
    expect('doneAt' in reopened).toBe(false)
    const file = JSON.parse(readFileSync(join(dir, 'memo.json'), 'utf8'))
    expect('doneAt' in file.items[0]).toBe(false)
  })

  it('改字去掉首尾空白、改成空白即拒绝；删除；不存在的事项拒绝', async () => {
    const store = await open()
    const item = await store.create('a')

    expect((await store.update(item.id, { text: ' b ' })).text).toBe('b')
    await expect(store.update(item.id, { text: '   ' })).rejects.toThrow('备忘内容不能为空')
    await expect(store.create('  ')).rejects.toThrow('备忘内容不能为空')

    await store.remove(item.id)
    expect(store.list()).toEqual([])
    await expect(store.remove(item.id)).rejects.toThrow(`备忘事项不存在：${item.id}`)
    await expect(store.update('nope', { done: true })).rejects.toThrow('备忘事项不存在：nope')
  })

  it('并发新建排队执行，互不覆盖', async () => {
    const store = await open()
    await Promise.all([store.create('一'), store.create('二'), store.create('三')])

    const reloaded = await open()
    expect(reloaded.list().map((m) => m.text)).toEqual(['一', '二', '三'])
  })

  it('版本高于本程序支持的拒绝加载；格式不对报带路径的错', async () => {
    const file = join(dir, 'memo.json')
    writeFileSync(file, JSON.stringify({ version: 2, items: [] }))
    await expect(new MemoStore(dir).load()).rejects.toThrow(/请升级 TagTerm/)

    writeFileSync(file, JSON.stringify({ version: 1, things: [] }))
    await expect(new MemoStore(dir).load()).rejects.toThrow(`数据文件格式不正确：${file}`)
  })

  it('写盘失败：内存保持改之前、不回调、原样抛', async () => {
    const changes: MemoItem[][] = []
    const store = await open((items) => changes.push(items))
    const item = await store.create('a')
    changes.length = 0
    const file = join(dir, 'memo.json')
    chmodSync(file, 0o444) // 只读：原子写最后一步 rename 覆盖它时 EPERM，原内容保留
    try {
      await expect(store.update(item.id, { done: true })).rejects.toThrow(/EPERM/)
      await expect(store.create('b')).rejects.toThrow(/EPERM/)
      await expect(store.remove(item.id)).rejects.toThrow(/EPERM/)
    } finally {
      chmodSync(file, 0o666)
    }
    expect(store.list()).toEqual([item])
    expect(changes).toEqual([])
  })
})
