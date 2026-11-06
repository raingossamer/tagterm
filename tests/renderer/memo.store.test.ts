import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMemoStore } from '../../src/renderer/src/stores/memo'
import { installFakeApi, makeMemo } from './fakeApi'
import type { MemoItem } from '@shared/models'

describe('memo store：镜像主进程的备忘事项', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('load 拉取一次并订阅 memo:changed 全量替换', async () => {
    const first = makeMemo({ text: 'a' })
    let push: ((items: MemoItem[]) => void) | null = null
    installFakeApi({
      memo: {
        list: async () => [first],
        onChanged: (cb) => {
          push = cb
          return () => {}
        },
      },
    })
    const memo = useMemoStore()

    await memo.load()
    expect(memo.items).toEqual([first])

    const second = makeMemo({ text: 'b' })
    push!([first, second])
    expect(memo.items).toEqual([first, second])
  })

  it('action 只调 SDK、不本地改列表（以广播为准）', async () => {
    const api = installFakeApi()
    const memo = useMemoStore()

    await memo.create('写周报')
    await memo.update('m1', { done: true })
    await memo.remove('m1')

    expect(api.memo.create).toHaveBeenCalledWith('写周报')
    expect(api.memo.update).toHaveBeenCalledWith('m1', { done: true })
    expect(api.memo.remove).toHaveBeenCalledWith('m1')
    expect(memo.items).toEqual([])
  })
})
