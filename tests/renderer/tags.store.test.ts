import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TagListResult } from '@shared/ipc'
import { useTagsStore } from '../../src/renderer/src/stores/tags'
import { useSessionsStore } from '../../src/renderer/src/stores/sessions'
import { installFakeApi, makeSession, makeTag } from './fakeApi'

describe('tags store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('load() 拉取标签与关联；主进程广播后全量替换', async () => {
    const a = makeTag({ name: 'simba' })
    let broadcast: ((r: TagListResult) => void) | undefined
    installFakeApi({
      tag: {
        list: async () => ({ tags: [a], sessionTags: [{ sessionId: 's1', tagId: a.id }] }),
        onChanged: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })

    const store = useTagsStore()
    expect(store.tags).toEqual([])
    await store.load()
    expect(store.tags).toEqual([a])
    expect(store.sessionTags).toEqual([{ sessionId: 's1', tagId: a.id }])

    const b = makeTag({ name: 'java' })
    broadcast!({ tags: [b], sessionTags: [] })
    expect(store.tags).toEqual([b])
    expect(store.sessionTags).toEqual([])
  })

  it('tagsOf / countOf 以会话列表为主表内连接：按标签 sortOrder 排序，悬空引用（标签或会话不存在）忽略', async () => {
    const s1 = makeSession()
    const s2 = makeSession()
    useSessionsStore().sessions = [s1, s2]
    const java = makeTag({ name: 'java', sortOrder: 2 })
    const simba = makeTag({ name: 'simba', sortOrder: 1 })
    installFakeApi({
      tag: {
        list: async () => ({
          tags: [java, simba],
          sessionTags: [
            { sessionId: s1.id, tagId: java.id },
            { sessionId: s1.id, tagId: simba.id },
            { sessionId: s1.id, tagId: 'ghost-tag' },
            { sessionId: 'ghost-session', tagId: java.id },
            { sessionId: s2.id, tagId: java.id },
          ],
        }),
      },
    })
    const store = useTagsStore()
    await store.load()

    expect(store.tagsOf(s1.id).map((t) => t.name)).toEqual(['simba', 'java'])
    expect(store.tagsOf(s2.id).map((t) => t.name)).toEqual(['java'])
    expect(store.tagsOf('ghost-session')).toEqual([])
    expect(store.countOf(java.id)).toBe(2)
    expect(store.countOf(simba.id)).toBe(1)
    expect(store.countOf('ghost-tag')).toBe(0)
    expect(store.sortedTags.map((t) => t.name)).toEqual(['simba', 'java'])
  })

  it('create / update / remove / attach / detach 只调 SDK，不本地改数据（列表以广播为准）', async () => {
    const api = installFakeApi()
    const store = useTagsStore()
    await store.load()

    const created = await store.create(' simba ')
    expect(api.tag.create).toHaveBeenCalledWith(' simba ', undefined)
    expect(created.name).toBe(' simba ')
    await store.update('t9', { color: '#D14343' })
    expect(api.tag.update).toHaveBeenCalledWith('t9', { color: '#D14343' })
    await store.remove('t9')
    expect(api.tag.remove).toHaveBeenCalledWith('t9')
    await store.attach('s1', 't9')
    expect(api.tag.attach).toHaveBeenCalledWith('s1', 't9')
    await store.detach('s1', 't9')
    expect(api.tag.detach).toHaveBeenCalledWith('s1', 't9')
    expect(store.tags).toEqual([])
    expect(store.sessionTags).toEqual([])
  })
})
