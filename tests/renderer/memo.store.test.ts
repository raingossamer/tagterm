import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMemoStore } from '../../src/renderer/src/stores/memo'
import { useWorkspaceStore } from '../../src/renderer/src/stores/workspace'
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

  it('弹窗开关：打开 / 关闭各向主进程报一次（重复的不报），关闭后焦点回到当前终端', () => {
    const api = installFakeApi()
    const memo = useMemoStore()
    const focusActive = vi.spyOn(useWorkspaceStore(), 'focusActive')

    memo.open()
    memo.open()
    expect(memo.isOpen).toBe(true)
    expect(focusActive).not.toHaveBeenCalled()

    memo.close()
    memo.close()
    expect(memo.isOpen).toBe(false)
    expect(api.app.reportMemoVisibility).toHaveBeenNthCalledWith(1, true)
    expect(api.app.reportMemoVisibility).toHaveBeenNthCalledWith(2, false)
    expect(api.app.reportMemoVisibility).toHaveBeenCalledTimes(2)
    expect(focusActive).toHaveBeenCalledTimes(1)
  })
})
