import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMemoStore } from '../../src/renderer/src/stores/memo'
import { installFakeMemoApi, makeMemo } from './fakeApi'
import type { MemoItem } from '@shared/models'

// memo-floating-window：store 只在备忘小窗里用，经小窗自己的 window.tagterm（memo 一组）；开关归主进程，不在 store
describe('memo store：镜像主进程的备忘事项', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('load 拉取一次并订阅 memo:changed 全量替换', async () => {
    const first = makeMemo({ text: 'a' })
    let push: ((items: MemoItem[]) => void) | null = null
    installFakeMemoApi({
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

  it('拉取失败不抛（小窗只有这一份数据，挂不起来就什么都看不见）：原因记在 loadError，页面显示它', async () => {
    installFakeMemoApi({
      memo: {
        list: async () => {
          throw new Error('数据文件损坏')
        },
      },
    })
    const memo = useMemoStore()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(memo.load()).resolves.toBeUndefined()
    expect(memo.loadError).toBe('数据文件损坏')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('action 只调 SDK、不本地改列表（以广播为准）', async () => {
    const api = installFakeMemoApi()
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
