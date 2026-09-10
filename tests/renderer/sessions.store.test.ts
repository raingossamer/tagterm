import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@shared/models'
import { useSessionsStore } from '../../src/renderer/src/stores/sessions'
import { installFakeApi, makeSession } from './fakeApi'

describe('sessions store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('load() 拉取列表；主进程广播 session:changed 后全量替换', async () => {
    const a = makeSession({ name: 'a' })
    const b = makeSession({ name: 'b' })
    let broadcast: ((sessions: Session[]) => void) | undefined
    installFakeApi({
      session: {
        list: async () => [a],
        onChanged: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })

    const store = useSessionsStore()
    await store.load()
    expect(store.sessions).toEqual([a])
    expect(store.count).toBe(1)

    broadcast!([a, b])
    expect(store.sessions).toEqual([a, b])
    expect(store.byId(b.id)).toEqual(b)
  })

  it('create / remove 只调 SDK，列表以主进程广播为准', async () => {
    const api = installFakeApi()
    const store = useSessionsStore()
    await store.load()

    const created = await store.create({ cwd: 'D:\\x' })
    expect(api.session.create).toHaveBeenCalledWith({ cwd: 'D:\\x' })
    expect(created.cwd).toBe('D:\\x')
    expect(store.sessions).toEqual([]) // 未收到广播前不本地改数组

    await store.remove('s1')
    expect(api.session.remove).toHaveBeenCalledWith('s1')
  })
})
