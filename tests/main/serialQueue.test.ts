import { describe, expect, it } from 'vitest'
import { createSerialQueue } from '../../src/main/store/serialQueue'

describe('createSerialQueue', () => {
  it('按提交顺序一个接一个执行：后一个要等前一个完成才开始', async () => {
    const queue = createSerialQueue()
    const log: string[] = []
    let releaseFirst: () => void = () => {}
    const first = queue.run(async () => {
      log.push('一开始')
      await new Promise<void>((resolve) => (releaseFirst = resolve))
      log.push('一结束')
      return 1
    })
    const second = queue.run(async () => {
      log.push('二开始')
      return 2
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(log).toEqual(['一开始'])

    releaseFirst()
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(log).toEqual(['一开始', '一结束', '二开始'])
  })

  it('前一个失败只让它自己的调用方拿到错误，不挡后一个', async () => {
    const queue = createSerialQueue()
    const failing = queue.run(async () => {
      throw new Error('写不进去')
    })
    const next = queue.run(async () => '照常执行')
    await expect(failing).rejects.toThrow('写不进去')
    await expect(next).resolves.toBe('照常执行')
  })
})
