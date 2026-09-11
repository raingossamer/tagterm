import { describe, expect, it } from 'vitest'
import type { Session, SessionTag, Tag } from '@shared/models'
import {
  buildSessionGroups,
  type GroupInput,
} from '../../src/renderer/src/composables/useSessionGroups'
import { makeSession, makeTag } from './fakeApi'

// 以原型 buildGroups 为对照：示例数据 s1–s4、t1–t3
const simba = makeTag({ id: 't1', name: 'simba', sortOrder: 1 })
const java = makeTag({ id: 't2', name: 'java', sortOrder: 2 })
const iot = makeTag({ id: 't3', name: 'iot', sortOrder: 3 })
const s1 = makeSession({ id: 's1', name: 'simba-api', cwd: 'D:/Projects/simba/api', sortOrder: 1 })
const s2 = makeSession({ id: 's2', name: 'simba-web', cwd: 'D:/Projects/simba/web', sortOrder: 2 })
const s3 = makeSession({ id: 's3', name: 'gateway', cwd: 'C:/work/iot/gateway', sortOrder: 3 })
const s4 = makeSession({ id: 's4', name: 'scratch', cwd: 'C:/tmp/scratch', sortOrder: 4 })

function input(partial: Partial<GroupInput>): GroupInput {
  return {
    sessions: [] as Session[],
    tags: [] as Tag[],
    sessionTags: [] as SessionTag[],
    selected: new Set<string>(),
    mode: 'any',
    search: '',
    ...partial,
  }
}

const summarize = (groups: ReturnType<typeof buildSessionGroups>) =>
  groups.map((g) => [g.key, g.title, g.color, g.sessions.map((s) => s.id)])

describe('buildSessionGroups（无筛选、无搜索）', () => {
  it('没有任何标签时只有「未打标签」一组，会话按 sortOrder 排列', () => {
    const groups = buildSessionGroups(input({ sessions: [s2, s1] }))
    expect(summarize(groups)).toEqual([['untagged', '未打标签', null, ['s1', 's2']]])
  })

  it('每个标签一组（按标签 sortOrder），多标签会话出现在每个组；无会话的标签组仍存在；未打标签组仅有内容时出现', () => {
    const groups = buildSessionGroups(
      input({
        sessions: [s4, s3, s2, s1],
        tags: [iot, java, simba],
        sessionTags: [
          { sessionId: 's1', tagId: 't1' },
          { sessionId: 's1', tagId: 't2' },
          { sessionId: 's2', tagId: 't1' },
          { sessionId: 's3', tagId: 't3' },
        ],
      }),
    )
    expect(summarize(groups)).toEqual([
      ['t1', 'simba', simba.color, ['s1', 's2']],
      ['t2', 'java', java.color, ['s1']],
      ['t3', 'iot', iot.color, ['s3']],
      ['untagged', '未打标签', null, ['s4']],
    ])

    const allTagged = buildSessionGroups(
      input({
        sessions: [s1],
        tags: [simba, java],
        sessionTags: [{ sessionId: 's1', tagId: 't1' }],
      }),
    )
    expect(summarize(allTagged)).toEqual([
      ['t1', 'simba', simba.color, ['s1']],
      ['t2', 'java', java.color, []],
    ])
  })

  it('悬空引用（标签或会话不存在）不产生条目，该会话按其余有效标签归组，无有效标签则归未打标签', () => {
    const groups = buildSessionGroups(
      input({
        sessions: [s1, s2],
        tags: [simba],
        sessionTags: [
          { sessionId: 's1', tagId: 'ghost-tag' },
          { sessionId: 'ghost-session', tagId: 't1' },
          { sessionId: 's2', tagId: 't1' },
        ],
      }),
    )
    expect(summarize(groups)).toEqual([
      ['t1', 'simba', simba.color, ['s2']],
      ['untagged', '未打标签', null, ['s1']],
    ])
  })
})
