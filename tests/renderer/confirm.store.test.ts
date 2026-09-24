import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConfirmStore } from '../../src/renderer/src/stores/confirm'

describe('confirm store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('ask 挂出一条请求并返回 Promise，answer 作答后请求清空、Promise 得到答案', async () => {
    const confirm = useConfirmStore()
    expect(confirm.request).toBeNull()

    const yes = confirm.ask('移除会话 "a"？终端进程会被结束。', { danger: true })
    expect(confirm.request).toEqual({ message: '移除会话 "a"？终端进程会被结束。', danger: true })
    confirm.answer(true)
    await expect(yes).resolves.toBe(true)
    expect(confirm.request).toBeNull()

    const no = confirm.ask('继续？')
    expect(confirm.request).toEqual({ message: '继续？', danger: false })
    confirm.answer(false)
    await expect(no).resolves.toBe(false)
  })

  it('同时只有一条：新的请求顶掉还没作答的旧请求，旧的按取消处理', async () => {
    const confirm = useConfirmStore()
    const first = confirm.ask('第一条')
    const second = confirm.ask('第二条')
    await expect(first).resolves.toBe(false)
    expect(confirm.request?.message).toBe('第二条')
    confirm.answer(true)
    await expect(second).resolves.toBe(true)
  })

  it('没有请求时 answer 什么都不做', () => {
    const confirm = useConfirmStore()
    expect(() => confirm.answer(true)).not.toThrow()
    expect(confirm.request).toBeNull()
  })
})
