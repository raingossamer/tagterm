/**
 * 服务层（深模块）：tags.json 的加载、标签 CRUD、会话与标签的多对多关联、版本校验与原子写。
 * 目录以构造参数注入；不 import electron。文件不存在视为空集合（与 sessions.json 一致）。
 * 会话是否存在由会话子系统核对，本模块只保证标签侧的约束。
 * 变更经串行队列一个接一个执行，每次先按已提交的数据算出整份新数据写盘，成功才换内存并回调。
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { TagListResult, TagPatch } from '@shared/ipc'
import {
  TAG_COLORS,
  TAGS_FILE_VERSION,
  type SessionTag,
  type Tag,
  type TagColor,
  type TagsFile,
} from '@shared/models'
import { readJson, writeJsonAtomic } from './jsonFile'
import { createSerialQueue } from './serialQueue'

const TAGS_FILE = 'tags.json'

/** 配置导入给的一条标签（不带 id，按名找本机的） */
export interface TagImportEntry {
  name: string
  color: TagColor
  hidden?: boolean
}

export interface TagImportResult {
  created: number
  updated: number
}

export interface TagStoreDeps {
  /** 每次变更落盘后回调全量数据，由装配层广播 tag:changed（启动清理不回调） */
  onChanged?: (result: TagListResult) => void
}

export class TagStore {
  private tags: Tag[] = []
  private sessionTags: SessionTag[] = []
  /** 变更一个接一个执行：每次都从前一次提交后的数据算起（见 serialQueue） */
  private readonly queue = createSerialQueue()
  private readonly file: string
  private readonly onChanged: (result: TagListResult) => void

  constructor(dir: string, deps: TagStoreDeps = {}) {
    this.file = join(dir, TAGS_FILE)
    this.onChanged = deps.onChanged ?? (() => {})
  }

  /** 文件不存在 → 空集合 */
  async load(): Promise<void> {
    const raw = await readJson(this.file)
    if (raw === null) {
      this.tags = []
      this.sessionTags = []
      return
    }
    const file = raw as Partial<TagsFile>
    if (
      typeof file.version !== 'number' ||
      !Array.isArray(file.tags) ||
      !Array.isArray(file.sessionTags)
    ) {
      throw new Error(`标签文件格式不正确：${this.file}`)
    }
    if (file.version > TAGS_FILE_VERSION) {
      throw new Error(
        `标签文件版本 ${file.version} 高于本程序支持的版本 ${TAGS_FILE_VERSION}，请升级 TagTerm：${this.file}`,
      )
    }
    this.tags = file.tags
    this.sessionTags = file.sessionTags
    console.log(
      `[store] 已加载 ${this.tags.length} 个标签、${this.sessionTags.length} 条关联：${this.file}`,
    )
  }

  list(): TagListResult {
    return { tags: [...this.tags], sessionTags: [...this.sessionTags] }
  }

  /** 同名（trim 后精确匹配）返回已有标签；颜色缺省按当前标签数对八色表轮转 */
  create(name: string, color?: TagColor): Promise<Tag> {
    return this.queue.run(async () => {
      const trimmed = assertName(name)
      const existing = this.findByName(trimmed)
      if (existing) return existing
      const tag: Tag = {
        id: randomUUID(),
        name: trimmed,
        color: color ?? TAG_COLORS[this.tags.length % TAG_COLORS.length]!,
        sortOrder: this.tags.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1,
      }
      await this.commit([...this.tags, tag], this.sessionTags)
      return tag
    })
  }

  /** 改名 trim 后校验非空且不与其他标签撞名；颜色只允许八色之一 */
  update(id: string, patch: TagPatch): Promise<Tag> {
    return this.queue.run(async () => {
      const tag = this.get(id)
      const next: Tag = { ...tag }
      if (patch.name !== undefined) {
        const name = assertName(patch.name)
        const other = this.findByName(name)
        if (other && other.id !== id) throw new Error(`已有同名标签：${name}`)
        next.name = name
      }
      if (patch.color !== undefined) next.color = assertColor(patch.color)
      // hidden 是可选字段：true 落盘写键，false 删键（缺省 = 显示，见 sql.md「约定」可选字段缺省不写）
      if (patch.hidden !== undefined) {
        if (patch.hidden) next.hidden = true
        else delete next.hidden
      }
      await this.commit(
        this.tags.map((t) => (t === tag ? next : t)),
        this.sessionTags,
      )
      return next
    })
  }

  /** 按 ids 顺序整体重排 sortOrder 为 1..n；ids 必须是当前全部标签 id 的一个排列，否则拒绝且不改动 */
  reorder(ids: readonly string[]): Promise<void> {
    return this.queue.run(async () => {
      const current = new Set(this.tags.map((t) => t.id))
      const given = new Set(ids)
      if (
        ids.length !== this.tags.length ||
        given.size !== ids.length ||
        ![...given].every((id) => current.has(id))
      ) {
        throw new Error('排序参数必须是全部标签 id 的一个排列')
      }
      const byId = new Map(this.tags.map((t) => [t.id, t]))
      await this.commit(
        ids.map((id, i) => ({ ...byId.get(id)!, sortOrder: i + 1 })),
        this.sessionTags,
      )
    })
  }

  /** 删标签并解除其全部关联（一次原子写），会话本身保留 */
  remove(id: string): Promise<void> {
    return this.queue.run(async () => {
      const tag = this.get(id)
      await this.commit(
        this.tags.filter((t) => t !== tag),
        this.sessionTags.filter((st) => st.tagId !== id),
      )
    })
  }

  /** 幂等：已有关联不重复写 */
  attach(sessionId: string, tagId: string): Promise<void> {
    return this.queue.run(async () => {
      this.get(tagId)
      if (this.hasLink(sessionId, tagId)) return
      await this.commit(this.tags, [...this.sessionTags, { sessionId, tagId }])
    })
  }

  /** 不存在的关联静默 */
  detach(sessionId: string, tagId: string): Promise<void> {
    return this.queue.run(async () => {
      if (!this.hasLink(sessionId, tagId)) return
      await this.commit(
        this.tags,
        this.sessionTags.filter((st) => !(st.sessionId === sessionId && st.tagId === tagId)),
      )
    })
  }

  /** 移除会话时由会话子系统调用：清掉该会话的全部关联 */
  detachAllOf(sessionId: string): Promise<void> {
    return this.queue.run(async () => {
      const next = this.sessionTags.filter((st) => st.sessionId !== sessionId)
      if (next.length === this.sessionTags.length) return
      await this.commit(this.tags, next)
    })
  }

  /**
   * 启动时由会话子系统在两份文件都加载后调用：清掉指向不存在会话或标签的关联（崩溃遗留），
   * 落盘但不回调 onChanged（渲染进程尚未订阅）。返回清掉的条数。
   */
  pruneDangling(sessionIds: readonly string[]): Promise<number> {
    return this.queue.run(async () => {
      const sessions = new Set(sessionIds)
      const tagIds = new Set(this.tags.map((t) => t.id))
      const kept = this.sessionTags.filter(
        (st) => sessions.has(st.sessionId) && tagIds.has(st.tagId),
      )
      const removed = this.sessionTags.length - kept.length
      if (removed === 0) return 0
      await this.commit(this.tags, kept, { silent: true })
      console.log(`[store] 已清理 ${removed} 条悬空的会话标签关联：${this.file}`)
      return removed
    })
  }

  /**
   * 配置导入的「按名合并」（一次原子写、一次回调）：给的每一条按名（trim 后精确匹配，与唯一性同一规则）找本机标签，
   * 找到的沿用它的 id（会话关联不动），颜色与隐藏用给的；没找到的新建；给的按顺序排在前（sortOrder 1..k），
   * 本机独有的按原顺序接在后。不删任何标签或关联。与本机完全一样时不写盘、不回调。返回新建 / 更新的条数
   */
  importByName(entries: readonly TagImportEntry[]): Promise<TagImportResult> {
    return this.queue.run(async () => {
      const byName = new Map(this.tags.map((t) => [t.name, t]))
      const merged: Tag[] = []
      const seen = new Set<string>()
      let created = 0
      let updated = 0
      for (const entry of entries) {
        const name = assertName(entry.name)
        if (seen.has(name)) throw new Error(`标签重名：${name}`)
        seen.add(name)
        const existing = byName.get(name)
        const next: Tag = {
          id: existing?.id ?? randomUUID(),
          name,
          color: assertColor(entry.color),
          sortOrder: merged.length + 1,
        }
        if (entry.hidden) next.hidden = true
        if (!existing) created += 1
        else if (!isSameTag(existing, next)) updated += 1
        merged.push(next)
      }
      const taken = new Set(merged.map((t) => t.id))
      const rest = [...this.tags]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((t) => !taken.has(t.id))
      for (const tag of rest) merged.push({ ...tag, sortOrder: merged.length + 1 })
      const isUnchanged =
        merged.length === this.tags.length && merged.every((t, i) => isSameTag(t, this.tags[i]!))
      if (isUnchanged) return { created: 0, updated: 0 }
      await this.commit(merged, this.sessionTags)
      return { created, updated }
    })
  }

  /** 找不到即抛错（message 面向用户可读） */
  get(id: string): Tag {
    const tag = this.tags.find((t) => t.id === id)
    if (!tag) throw new Error(`标签不存在：${id}`)
    return tag
  }

  private hasLink(sessionId: string, tagId: string): boolean {
    return this.sessionTags.some((st) => st.sessionId === sessionId && st.tagId === tagId)
  }

  private findByName(name: string): Tag | undefined {
    return this.tags.find((t) => t.name === name)
  }

  /**
   * 先写盘、成功才换内存再回调（silent 不回调，启动清理用）：写失败时内存仍与文件一致、不广播、错误原样抛 ——
   * 先改内存的话，写失败后内存领先于文件，下一次任何成功落盘都会把这次失败的改动悄悄带进文件
   */
  private async commit(
    tags: Tag[],
    sessionTags: SessionTag[],
    { silent = false }: { silent?: boolean } = {},
  ): Promise<void> {
    const data: TagsFile = { version: TAGS_FILE_VERSION, tags, sessionTags }
    await writeJsonAtomic(this.file, data)
    this.tags = tags
    this.sessionTags = sessionTags
    if (!silent) this.onChanged(this.list())
  }
}

/** 两条标签记录完全一样（id、名、色、隐藏、排序） */
function isSameTag(a: Tag, b: Tag): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.color === b.color &&
    (a.hidden ?? false) === (b.hidden ?? false) &&
    a.sortOrder === b.sortOrder
  )
}

function assertColor(color: string): TagColor {
  if (!(TAG_COLORS as readonly string[]).includes(color)) throw new Error(`不支持的颜色：${color}`)
  return color as TagColor
}

function assertName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('标签名不能为空')
  return trimmed
}
