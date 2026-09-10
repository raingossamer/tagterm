import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { UpdateStatus } from '@shared/models'
import { useUpdateStore } from '../../src/renderer/src/stores/update'
import { installFakeApi } from './fakeApi'

describe('update store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('load() 取当前状态并订阅 update:status；check / download / install 只调 SDK', async () => {
    let broadcast: ((s: UpdateStatus) => void) | undefined
    const api = installFakeApi({
      update: {
        getStatus: async () => ({ state: 'none', version: '0.1.0' }),
        onStatus: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })
    const store = useUpdateStore()
    expect(store.status).toEqual({ state: 'idle' })
    await store.load()
    expect(store.status).toEqual({ state: 'none', version: '0.1.0' })

    broadcast!({ state: 'downloading', version: '0.2.0', percent: 30 })
    expect(store.status.percent).toBe(30)

    await store.check()
    await store.download()
    await store.install()
    expect(api.update.check).toHaveBeenCalledTimes(1)
    expect(api.update.download).toHaveBeenCalledTimes(1)
    expect(api.update.install).toHaveBeenCalledTimes(1)
  })
})
