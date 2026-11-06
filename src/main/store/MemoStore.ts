/**
 * 服务层（深模块）：memo.json（本周备忘的事项）的加载、增删改、版本校验与原子写。
 * 变更经串行队列一个接一个执行，每次先按已提交的数据算出整份新数据写盘，成功才换内存并回调。
 * 只认事项、不认周：归哪一周由 shared/week 按时间推算（勾选完成时这里写 doneAt）。不 import electron。
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { MemoPatch } from '@shared/ipc'
import { MEMO_FILE_VERSION, type MemoFile, type MemoItem } from '@shared/models'
import { readJson, writeJsonAtomic } from './jsonFile'
import { createSerialQueue } from './serialQueue'

const MEMO_FILE = 'memo.json'

export interface MemoStoreDeps {
  /** 每次变更落盘后回调全量列表，由装配层广播 memo:changed */
  onChanged?: (items: MemoItem[]) => void
  /** 时钟（测试注入） */
  now?: () => Date
}

export class MemoStore {
  private items: MemoItem[] = []
  private readonly queue = createSerialQueue()
  private readonly file: string
  private readonly onChanged: (items: MemoItem[]) => void
  private readonly now: () => Date

  constructor(dir: string, deps: MemoStoreDeps = {}) {
    this.file = join(dir, MEMO_FILE)
    this.onChanged = deps.onChanged ?? (() => {})
    this.now = deps.now ?? (() => new Date())
  }

  /** 文件不存在 → 空列表 */
  async load(): Promise<void> {
    const raw = await readJson(this.file)
    if (raw === null) {
      this.items = []
      return
    }
    const file = raw as Partial<MemoFile>
    if (typeof file.version !== 'number' || !Array.isArray(file.items)) {
      throw new Error(`数据文件格式不正确：${this.file}`)
    }
    if (file.version > MEMO_FILE_VERSION) {
      throw new Error(
        `数据文件版本 ${file.version} 高于本程序支持的版本 ${MEMO_FILE_VERSION}，请升级 TagTerm：${this.file}`,
      )
    }
    this.items = file.items
    console.log(`[store] 已加载 ${this.items.length} 条备忘：${this.file}`)
  }

  list(): MemoItem[] {
    return [...this.items]
  }

  create(text: string): Promise<MemoItem> {
    return this.queue.run(async () => {
      const item: MemoItem = {
        id: randomUUID(),
        text: requireText(text),
        done: false,
        createdAt: this.now().toISOString(),
      }
      await this.commit([...this.items, item])
      return item
    })
  }

  /** 勾选完成时写 doneAt（已完成的再勾不改原时间），取消勾选删键 */
  update(id: string, patch: MemoPatch): Promise<MemoItem> {
    return this.queue.run(async () => {
      const item = this.get(id)
      const next: MemoItem = { ...item }
      if (patch.text !== undefined) next.text = requireText(patch.text)
      if (patch.done === true && !item.done) {
        next.done = true
        next.doneAt = this.now().toISOString()
      } else if (patch.done === false) {
        next.done = false
        delete next.doneAt
      }
      await this.commit(this.items.map((m) => (m === item ? next : m)))
      return next
    })
  }

  remove(id: string): Promise<void> {
    return this.queue.run(async () => {
      const item = this.get(id)
      await this.commit(this.items.filter((m) => m !== item))
    })
  }

  private get(id: string): MemoItem {
    const item = this.items.find((m) => m.id === id)
    if (!item) throw new Error(`备忘事项不存在：${id}`)
    return item
  }

  /** 先写盘、成功才换内存再回调（写失败时内存仍与文件一致、不广播、错误原样抛） */
  private async commit(next: MemoItem[]): Promise<void> {
    const data: MemoFile = { version: MEMO_FILE_VERSION, items: next }
    await writeJsonAtomic(this.file, data)
    this.items = next
    this.onChanged(this.list())
  }
}

function requireText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('备忘内容不能为空')
  return trimmed
}
