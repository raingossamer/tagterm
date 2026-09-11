/**
 * 分组 / 筛选 / 搜索的纯计算（与原型 visible / buildGroups 等价）。
 * 输入会话、标签、关联与筛选状态，输出分组数组；组件只负责渲染。
 * 以会话列表为主表：sessionTags 里指向不存在会话或标签的引用一律忽略（两份文件各自广播的中间态）。
 */
import type { Session, SessionTag, Tag, TagColor } from '@shared/models'

export interface GroupInput {
  sessions: Session[]
  tags: Tag[]
  sessionTags: SessionTag[]
  selected: Set<string>
  mode: 'any' | 'all'
  search: string
}

export interface SessionGroup {
  key: string // tag.id | 'untagged' | 'all'
  title: string
  color: TagColor | null
  sessions: Session[]
}

export const UNTAGGED_KEY = 'untagged'

export function buildSessionGroups(input: GroupInput): SessionGroup[] {
  const tags = [...input.tags].sort((a, b) => a.sortOrder - b.sortOrder)
  const tagIds = new Set(tags.map((t) => t.id))
  // sessionId → 该会话的有效标签 id 集合（只保留存在的标签）
  const tagsOf = new Map<string, Set<string>>()
  for (const st of input.sessionTags) {
    if (!tagIds.has(st.tagId)) continue
    let set = tagsOf.get(st.sessionId)
    if (!set) tagsOf.set(st.sessionId, (set = new Set()))
    set.add(st.tagId)
  }
  const hasTag = (s: Session, tagId: string): boolean => tagsOf.get(s.id)?.has(tagId) ?? false

  const ordered = [...input.sessions].sort((a, b) => a.sortOrder - b.sortOrder)
  const groups: SessionGroup[] = tags.map((t) => ({
    key: t.id,
    title: t.name,
    color: t.color,
    sessions: ordered.filter((s) => hasTag(s, t.id)),
  }))
  const untagged = ordered.filter((s) => !tagsOf.get(s.id)?.size)
  if (untagged.length) {
    groups.push({ key: UNTAGGED_KEY, title: '未打标签', color: null, sessions: untagged })
  }
  return groups
}
