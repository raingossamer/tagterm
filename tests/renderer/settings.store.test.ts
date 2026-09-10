import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Settings } from '@shared/models'
import { useSettingsStore } from '../../src/renderer/src/stores/settings'
import { installFakeApi, makeCommand, makeSettings } from './fakeApi'

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('load() 拉取设置并按 pinned / sortOrder 拆成平铺区与「更多」；主进程广播后全量替换', async () => {
    const initial = makeSettings({
      launchCommands: [
        makeCommand({ command: 'pi', pinned: false, sortOrder: 2 }),
        makeCommand({ command: 'claude', sortOrder: 1 }),
      ],
    })
    let broadcast: ((s: Settings) => void) | undefined
    installFakeApi({
      settings: {
        get: async () => initial,
        onChanged: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })

    const store = useSettingsStore()
    expect(store.pinnedCommands).toEqual([]) // 加载前为空，不显示假按钮
    await store.load()
    expect(store.pinnedCommands.map((c) => c.command)).toEqual(['claude'])
    expect(store.moreCommands.map((c) => c.command)).toEqual(['pi'])

    broadcast!(makeSettings({ launchCommands: [makeCommand({ command: 'gemini' })] }))
    expect(store.pinnedCommands.map((c) => c.command)).toEqual(['gemini'])
    expect(store.moreCommands).toEqual([])
  })

  it('saveLaunchCommands 规整后只调 SDK，列表以主进程广播为准', async () => {
    const api = installFakeApi()
    const store = useSettingsStore()
    await store.load()

    await store.saveLaunchCommands([
      { label: '', command: ' gemini ', pinned: true, sortOrder: 9 },
      { label: 'x', command: '', pinned: false, sortOrder: 1 },
    ])
    expect(api.settings.update).toHaveBeenCalledWith({
      launchCommands: [{ label: 'gemini', command: 'gemini', pinned: true, sortOrder: 1 }],
    })
    expect(store.pinnedCommands.map((c) => c.command)).toEqual(['claude', 'gemini', 'pi'])
  })
})
