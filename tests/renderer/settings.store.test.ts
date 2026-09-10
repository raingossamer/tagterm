import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('背景图：load 后按 imagePath 读取 data: URL；广播换图后重新读取；清除后为 null', async () => {
    const withImage = makeSettings({
      terminalBackground: { imagePath: 'D:/a.png', dimOpacity: 0.4 },
    })
    let broadcast: ((s: Settings) => void) | undefined
    let dataUrl: string | null = 'data:image/png;base64,AAA'
    const api = installFakeApi({
      settings: {
        get: async () => withImage,
        readBackgroundImage: vi.fn(async () => dataUrl),
        onChanged: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })

    const store = useSettingsStore()
    await store.load()
    expect(store.backgroundImage).toBe('data:image/png;base64,AAA')
    expect(store.terminalBackground).toEqual({ imagePath: 'D:/a.png', dimOpacity: 0.4 })

    dataUrl = 'data:image/png;base64,BBB'
    broadcast!(makeSettings({ terminalBackground: { imagePath: 'D:/b.png', dimOpacity: 0.4 } }))
    await new Promise((r) => setTimeout(r, 0))
    expect(store.backgroundImage).toBe('data:image/png;base64,BBB')
    expect(api.settings.readBackgroundImage).toHaveBeenCalledTimes(2)

    broadcast!(makeSettings({ terminalBackground: { imagePath: null, dimOpacity: 0.4 } }))
    await new Promise((r) => setTimeout(r, 0))
    expect(store.backgroundImage).toBeNull()
    expect(api.settings.readBackgroundImage).toHaveBeenCalledTimes(2) // 未设置时不读文件
  })

  it('saveTerminalBackground 只调 SDK；previewDim 即时覆盖遮罩不透明度，保存 / 广播后清除', async () => {
    const api = installFakeApi()
    const store = useSettingsStore()
    await store.load()

    store.previewDim(0.2)
    expect(store.terminalBackground.dimOpacity).toBe(0.2)
    await store.saveTerminalBackground({ imagePath: 'D:/a.png', dimOpacity: 0.2 })
    expect(api.settings.update).toHaveBeenCalledWith({
      terminalBackground: { imagePath: 'D:/a.png', dimOpacity: 0.2 },
    })
    expect(store.terminalBackground.dimOpacity).toBe(0.6) // 未收到广播前以主进程数据为准
  })
})
