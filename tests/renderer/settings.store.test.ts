import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_BACKGROUND, type Settings } from '@shared/models'
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

  it('背景：load 后按 imagePath 读取 data: URL；广播换图后重新读取；清除后为 null', async () => {
    const withImage = makeSettings({
      background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/a.png' },
    })
    let broadcast: ((s: Settings) => void) | undefined
    let dataUrl: string | null = 'data:image/png;base64,AAA'
    const api = installFakeApi({
      settings: {
        get: async () => withImage,
        readBackgroundImage: vi.fn(async (_path?: string) => dataUrl),
        onChanged: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })

    const store = useSettingsStore()
    await store.load()
    expect(store.backgroundImage).toBe('data:image/png;base64,AAA')
    expect(store.background).toEqual({ ...DEFAULT_BACKGROUND, imagePath: 'D:/a.png' })
    expect(store.panelOpacity).toBe(DEFAULT_BACKGROUND.panelOpacity)

    dataUrl = 'data:image/png;base64,BBB'
    broadcast!(makeSettings({ background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/b.png' } }))
    await new Promise((r) => setTimeout(r, 0))
    expect(store.backgroundImage).toBe('data:image/png;base64,BBB')
    expect(api.settings.readBackgroundImage).toHaveBeenCalledTimes(2)

    broadcast!(makeSettings({ background: { ...DEFAULT_BACKGROUND, imagePath: null } }))
    await new Promise((r) => setTimeout(r, 0))
    expect(store.backgroundImage).toBeNull()
    expect(store.panelOpacity).toBe(1) // 没有背景图时面板恢复完全不透明
    expect(api.settings.readBackgroundImage).toHaveBeenCalledTimes(2) // 未设置时不读文件
  })

  it('previewBackground 即时覆盖生效背景（换图时读新图的 data: URL）；saveBackground 只调 SDK，广播后清预览', async () => {
    let broadcast: ((s: Settings) => void) | undefined
    const api = installFakeApi({
      settings: {
        readBackgroundImage: vi.fn(async (path?: string) => `data:image/png;base64,${path}`),
        onChanged: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })
    const store = useSettingsStore()
    await store.load()
    expect(store.background).toEqual(DEFAULT_BACKGROUND)

    // 只调参数：不重复读图
    await store.previewBackground({ ...DEFAULT_BACKGROUND, panelOpacity: 0.5, blurPx: 10 })
    expect(store.background).toMatchObject({ panelOpacity: 0.5, blurPx: 10 })
    expect(api.settings.readBackgroundImage).not.toHaveBeenCalled()

    // 换图：预览就要看到新图
    const picked = { ...DEFAULT_BACKGROUND, imagePath: 'D:/new.png' }
    await store.previewBackground(picked)
    expect(store.backgroundImage).toBe('data:image/png;base64,D:/new.png')

    // 保存：只调 SDK，落盘与广播由主进程负责
    await store.saveBackground(picked)
    expect(api.settings.update).toHaveBeenCalledWith({ background: picked })

    broadcast!(makeSettings({ background: picked }))
    await new Promise((r) => setTimeout(r, 0))
    expect(store.background).toEqual(picked)

    // 取消预览：回到已保存值
    await store.previewBackground({ ...picked, blurPx: 20 })
    expect(store.background.blurPx).toBe(20)
    await store.previewBackground(null)
    expect(store.background).toEqual(picked)
  })

  it('背景图读不出来（太大、格式不支持）：load / 广播 / 预览 / 还原都不抛，回退纯色并记下原因；同一路径不重读，换成读得出来的图即清掉原因', async () => {
    const TOO_BIG = '背景图片太大（40 MB），请换一张小于 30 MB 的'
    let broadcast: ((s: Settings) => void) | undefined
    const api = installFakeApi({
      settings: {
        get: async () =>
          makeSettings({ background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/huge.png' } }),
        readBackgroundImage: vi.fn(async (path?: string) => {
          if (path?.includes('huge')) throw new Error(TOO_BIG)
          return `data:image/png;base64,${path}`
        }),
        onChanged: (cb) => {
          broadcast = cb
          return () => {}
        },
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useSettingsStore()

    // 启动：已保存的图读不出来也不让 load 失败（否则会话 / 标签整段加载不了）
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.backgroundImage).toBeNull()
    expect(store.panelOpacity).toBe(1)
    expect(store.imageError).toBe(TOO_BIG)
    expect(warn).toHaveBeenCalledTimes(1)

    // 只调参数、路径没变：不重读
    await store.previewBackground({ ...store.background, blurPx: 9 })
    expect(api.settings.readBackgroundImage).toHaveBeenCalledTimes(1)

    // 预览一张读得出来的：原因清掉；再预览一张读不出来的：回退纯色，不抛
    await store.previewBackground({ ...DEFAULT_BACKGROUND, imagePath: 'D:/ok.png' })
    expect(store.backgroundImage).toBe('data:image/png;base64,D:/ok.png')
    expect(store.imageError).toBe('')
    await expect(
      store.previewBackground({ ...DEFAULT_BACKGROUND, imagePath: 'D:/huge-2.png' }),
    ).resolves.toBeUndefined()
    expect(store.backgroundImage).toBeNull()
    expect(store.imageError).toBe(TOO_BIG)

    // 还原（取消）：已保存的也读不出来，同样不抛 —— 否则设置弹窗关不掉
    await expect(store.previewBackground(null)).resolves.toBeUndefined()
    expect(store.background.imagePath).toBe('D:/huge.png')
    expect(store.imageError).toBe(TOO_BIG)

    // 广播换成读得出来的图
    broadcast!(makeSettings({ background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/b.png' } }))
    await new Promise((r) => setTimeout(r, 0))
    expect(store.backgroundImage).toBe('data:image/png;base64,D:/b.png')
    expect(store.imageError).toBe('')
    warn.mockRestore()
  })
})
