/**
 * 服务层（深模块）：tags.json 的加载、标签 CRUD、会话与标签的多对多关联、版本校验与原子写。
 * 目录以构造参数注入；不 import electron。文件不存在视为空集合（与 sessions.json 一致）。
 * 会话是否存在由编排层（接口层）核对，本模块只保证标签侧的约束。
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

const TAGS_FILE = 'tags.json'

export interface TagStoreDeps {
  /** 每次变更落盘后回调全量数据，由装配层广播 tag:changed（启动清理不回调） */
  onChanged?: (result: TagListResult) => void
}

export class TagStore {
  private tags: Tag[] = []
  private sessionTags: SessionTag[] = []
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
  async create(name: string, color?: TagColor): Promise<Tag> {
    const trimmed = assertName(name)
    const existing = this.findByName(trimmed)
    if (existing) return existing
    const tag: Tag = {
      id: randomUUID(),
      name: trimmed,
      color: color ?? TAG_COLORS[this.tags.length % TAG_COLORS.length]!,
      sortOrder: this.tags.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1,
    }
    this.tags.push(tag)
    await this.save()
    return tag
  }

  /** 改名 trim 后校验非空且不与其他标签撞名；颜色只允许八色之一 */
  async update(id: string, patch: TagPatch): Promise<Tag> {
    const tag = this.get(id)
    const next: Tag = { ...tag }
    if (patch.name !== undefined) {
      const name = assertName(patch.name)
      const other = this.findByName(name)
      if (other && other.id !== id) throw new Error(`已有同名标签：${name}`)
      next.name = name
    }
    if (patch.color !== undefined) next.color = assertColor(patch.color)
    if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder
    this.tags[this.tags.indexOf(tag)] = next
    await this.save()
    return next
  }

  /** 删标签并解除其全部关联（一次原子写），会话本身保留 */
  async remove(id: string): Promise<void> {
    const tag = this.get(id)
    this.tags = this.tags.filter((t) => t !== tag)
    this.sessionTags = this.sessionTags.filter((st) => st.tagId !== id)
    await this.save()
  }

  /** 幂等：已有关联不重复写 */
  async attach(sessionId: string, tagId: string): Promise<void> {
    this.get(tagId)
    if (this.hasLink(sessionId, tagId)) return
    this.sessionTags.push({ sessionId, tagId })
    await this.save()
  }

  /** 不存在的关联静默 */
  async detach(sessionId: string, tagId: string): Promise<void> {
    if (!this.hasLink(sessionId, tagId)) return
    this.sessionTags = this.sessionTags.filter(
      (st) => !(st.sessionId === sessionId && st.tagId === tagId),
    )
    await this.save()
  }

  /** 移除会话时由编排层调用：清掉该会话的全部关联 */
  async detachAllOf(sessionId: string): Promise<void> {
    const next = this.sessionTags.filter((st) => st.sessionId !== sessionId)
    if (next.length === this.sessionTags.length) return
    this.sessionTags = next
    await this.save()
  }

  /**
   * 启动时由装配层在两份文件都加载后调用：清掉指向不存在会话或标签的关联（崩溃遗留），
   * 落盘但不回调 onChanged（渲染进程尚未订阅）。返回清掉的条数。
   */
  async pruneDangling(sessionIds: readonly string[]): Promise<number> {
    const sessions = new Set(sessionIds)
    const tagIds = new Set(this.tags.map((t) => t.id))
    const kept = this.sessionTags.filter((st) => sessions.has(st.sessionId) && tagIds.has(st.tagId))
    const removed = this.sessionTags.length - kept.length
    if (removed === 0) return 0
    this.sessionTags = kept
    await this.write()
    console.log(`[store] 已清理 ${removed} 条悬空的会话标签关联：${this.file}`)
    return removed
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

  private async save(): Promise<void> {
    await this.write()
    this.onChanged(this.list())
  }

  private write(): Promise<void> {
    const data: TagsFile = {
      version: TAGS_FILE_VERSION,
      tags: this.tags,
      sessionTags: this.sessionTags,
    }
    return writeJsonAtomic(this.file, data)
  }
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
