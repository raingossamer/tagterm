/**
 * 标签与关联镜像：主进程是真相源，load() 拉取一次并订阅 tag:changed 全量替换；
 * action 只调 SDK，不本地改数据。
 * 派生（tagsOf / countOf）以会话列表为主表做内连接：两份文件各自广播，移除会话时会有一帧
 * 关联指向已不存在的会话，这类悬空引用一律当不存在。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { TagPatch } from '@shared/ipc'
import type { SessionTag, Tag, TagColor } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import { useSessionsStore } from './sessions'

export const useTagsStore = defineStore('tags', () => {
  const sessions = useSessionsStore()
  const tags = ref<Tag[]>([])
  const sessionTags = ref<SessionTag[]>([])
  let unsubscribe: Unsubscribe | null = null

  const sortedTags = computed(() => [...tags.value].sort((a, b) => a.sortOrder - b.sortOrder))
  /** 左栏只用可见标签（未隐藏）：分组、筛选胶囊、行色点都按它派生 */
  const visibleTags = computed(() => sortedTags.value.filter((t) => !t.hidden))
  const byId = (id: string): Tag | undefined => tags.value.find((t) => t.id === id)

  /** 某会话的标签，按标签 sortOrder；会话不存在或关联指向不存在的标签 → 忽略 */
  function tagsOf(sessionId: string): Tag[] {
    if (!sessions.byId(sessionId)) return []
    const ids = new Set(
      sessionTags.value.filter((st) => st.sessionId === sessionId).map((st) => st.tagId),
    )
    return sortedTags.value.filter((t) => ids.has(t.id))
  }

  /** 同 tagsOf，但排除隐藏标签：左栏行色点、「同时在」用它 */
  function visibleTagsOf(sessionId: string): Tag[] {
    return tagsOf(sessionId).filter((t) => !t.hidden)
  }

  /** 某标签下的会话数：只数会话列表里存在的会话 */
  function countOf(tagId: string): number {
    if (!byId(tagId)) return 0
    return sessionTags.value.filter((st) => st.tagId === tagId && sessions.byId(st.sessionId))
      .length
  }

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.tag.onChanged((result) => {
      tags.value = result.tags
      sessionTags.value = result.sessionTags
    })
    const result = await window.tagterm.tag.list()
    tags.value = result.tags
    sessionTags.value = result.sessionTags
  }

  /** 同名返回已有（主进程保证幂等） */
  function create(name: string, color?: TagColor): Promise<Tag> {
    return window.tagterm.tag.create(name, color)
  }

  function update(id: string, patch: TagPatch): Promise<Tag> {
    return window.tagterm.tag.update(id, patch)
  }

  function reorder(ids: string[]): Promise<void> {
    return window.tagterm.tag.reorder(ids)
  }

  function remove(id: string): Promise<void> {
    return window.tagterm.tag.remove(id)
  }

  function attach(sessionId: string, tagId: string): Promise<void> {
    return window.tagterm.tag.attach(sessionId, tagId)
  }

  function detach(sessionId: string, tagId: string): Promise<void> {
    return window.tagterm.tag.detach(sessionId, tagId)
  }

  return {
    tags,
    sessionTags,
    sortedTags,
    visibleTags,
    byId,
    tagsOf,
    visibleTagsOf,
    countOf,
    load,
    create,
    update,
    reorder,
    remove,
    attach,
    detach,
  }
})
