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
export const ALL_KEY = 'all'

/** 搜索：trim、小写、名称或路径 contains */
function matchesSearch(s: Session, query: string): boolean {
  if (!query) return true
  return s.name.toLowerCase().includes(query) || s.cwd.toLowerCase().includes(query)
}

/**
 * 与原型 buildGroups 等价，两处更稳：选中集合里已不存在的标签 id 被忽略（删标签后的残留），
 * 有效选中为空即视为未筛选。
 */
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

  // 搜索先于分组
  const query = input.search.trim().toLowerCase()
  const visible = [...input.sessions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((s) => matchesSearch(s, query))

  const picked = tags.filter((t) => input.selected.has(t.id))
  const isFiltering = picked.length > 0

  // 「全部」：单组，内容为同时含全部选中标签的会话
  if (isFiltering && input.mode === 'all') {
    return [
      {
        key: ALL_KEY,
        title: picked.map((t) => t.name).join(' ∩ '),
        color: null,
        sessions: visible.filter((s) => picked.every((t) => hasTag(s, t.id))),
      },
    ]
  }

  // 无筛选：每个标签一组；「任一」：只显示选中标签各一组
  const list = isFiltering ? picked : tags
  const groups: SessionGroup[] = list.map((t) => ({
    key: t.id,
    title: t.name,
    color: t.color,
    sessions: visible.filter((s) => hasTag(s, t.id)),
  }))
  if (!isFiltering) {
    const untagged = visible.filter((s) => !tagsOf.get(s.id)?.size)
    if (untagged.length) {
      groups.push({ key: UNTAGGED_KEY, title: '未打标签', color: null, sessions: untagged })
    }
  }
  return groups
}
