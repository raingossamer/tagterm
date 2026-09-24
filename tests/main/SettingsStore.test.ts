import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/store/SettingsStore'
import { MAX_IMAGE_BYTES } from '../../src/main/store/backgroundImage'
import type { Settings } from '@shared/models'

// 用真实临时目录，不 mock fs；PATH 探测结果以 seedCommands 注入
describe('SettingsStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-settings-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('首次运行（无文件）按注入的探测结果生成唤起命令并写出 settings.json v2，背景为缺省值', async () => {
    const store = new SettingsStore(dir, { seedCommands: ['claude', 'gemini', 'pi'] })
    await store.load()

    const settings = store.get()
    expect(settings.launchCommands.map((c) => [c.label, c.command, c.pinned, c.sortOrder])).toEqual(
      [
        ['claude', 'claude', true, 1],
        ['gemini', 'gemini', true, 2],
        ['pi', 'pi', true, 3],
      ],
    )
    expect(new Set(settings.launchCommands.map((c) => c.id)).size).toBe(3)
    expect(settings.background).toEqual({
      imagePath: null,
      fit: 'contain',
      imageOpacity: 0.35,
      panelOpacity: 0.75,
      blurPx: 4,
    })

    const file = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(file).toEqual({ version: 2, ...settings })
  })

  it('文件已存在时完全以文件为准，不再按探测结果增删', async () => {
    const first = new SettingsStore(dir, { seedCommands: ['claude'] })
    await first.load()

    const reloaded = new SettingsStore(dir, { seedCommands: ['claude', 'gemini', 'codex'] })
    await reloaded.load()
    expect(reloaded.get()).toEqual(first.get())
  })

  it('读到 v1 文件：迁移为 v2（搬 imagePath、丢 dimOpacity、其余取缺省）并立即写回', async () => {
    const file = join(dir, 'settings.json')
    const claude = { id: 'c-1', label: 'claude', command: 'claude', pinned: true, sortOrder: 1 }
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        launchCommands: [claude],
        terminalBackground: { imagePath: 'D:/wall/bg.png', dimOpacity: 0.6 },
      }),
      'utf8',
    )

    const store = new SettingsStore(dir, { seedCommands: ['gemini'] })
    await store.load()

    // 唤起命令原样保留；背景只继承图片路径，遮罩不透明度在新模型里没有对应物，丢弃
    expect(store.get()).toEqual({
      launchCommands: [claude],
      background: {
        imagePath: 'D:/wall/bg.png',
        fit: 'contain',
        imageOpacity: 0.35,
        panelOpacity: 0.75,
        blurPx: 4,
      },
    })
    // 迁移结果立即落盘，下次启动不必再迁
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, ...store.get() })
  })

  it('格式不正确 / 版本过高 / 坏 JSON 的文件拒绝加载并提示路径，不静默重置', async () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ version: 1, launchCommands: 'nope' }), 'utf8')
    await expect(new SettingsStore(dir, { seedCommands: [] }).load()).rejects.toThrow(file)

    writeFileSync(file, JSON.stringify({ version: 99, launchCommands: [] }), 'utf8')
    await expect(new SettingsStore(dir, { seedCommands: [] }).load()).rejects.toThrow(/版本/)

    writeFileSync(file, '{ not json', 'utf8')
    await expect(new SettingsStore(dir, { seedCommands: [] }).load()).rejects.toThrow(file)
  })

  it('update 以补丁合并：新命令自动分配 id、已有 id 保留；每次变更落盘并回调全量设置', async () => {
    const received: Settings[] = []
    const store = new SettingsStore(dir, {
      seedCommands: ['claude'],
      onChanged: (settings) => received.push(settings),
    })
    await store.load()
    const [claude] = store.get().launchCommands

    const updated = await store.update({
      launchCommands: [
        { label: 'pi 模型 x', command: 'pi --model x', pinned: false, sortOrder: 1 },
        { ...claude!, sortOrder: 2 },
      ],
    })
    expect(updated.launchCommands[0]).toMatchObject({ command: 'pi --model x', pinned: false })
    expect(updated.launchCommands[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(updated.launchCommands[1]).toEqual({ ...claude, sortOrder: 2 })

    const bg = {
      imagePath: 'D:/bg.png',
      fit: 'cover' as const,
      imageOpacity: 0.2,
      panelOpacity: 0.9,
      blurPx: 0,
    }
    await store.update({ background: bg })
    expect(store.get().background).toEqual(bg)
    expect(store.get().launchCommands).toEqual(updated.launchCommands)
    expect(received).toEqual([updated, store.get()])

    const reloaded = new SettingsStore(dir, { seedCommands: [] })
    await reloaded.load()
    expect(reloaded.get()).toEqual(store.get())
  })

  it('update 换了一张读不出来的新图（超过体积上限 / 格式不支持）→ reject 同一句中文，不落盘不回调；路径没变（存进去之后文件才变大）不拦别的改动', async () => {
    const received: Settings[] = []
    const store = new SettingsStore(dir, {
      seedCommands: [],
      onChanged: (settings) => received.push(settings),
    })
    await store.load()
    const before = store.get()
    const huge = join(dir, 'huge.png')
    writeFileSync(huge, Buffer.alloc(MAX_IMAGE_BYTES + 1))

    await expect(
      store.update({ background: { ...before.background, imagePath: huge } }),
    ).rejects.toThrow(/背景图片太大/)
    await expect(
      store.update({ background: { ...before.background, imagePath: join(dir, 'a.txt') } }),
    ).rejects.toThrow(/不支持的图片格式/)
    expect(store.get()).toEqual(before)
    expect(received).toEqual([])
    const file = join(dir, 'settings.json')
    expect(JSON.parse(readFileSync(file, 'utf8')).background.imagePath).toBeNull()

    const wall = join(dir, 'wall.png')
    writeFileSync(wall, 'png')
    await store.update({ background: { ...before.background, imagePath: wall } })
    writeFileSync(wall, Buffer.alloc(MAX_IMAGE_BYTES + 1))
    await store.update({ background: { ...before.background, imagePath: wall, blurPx: 10 } })
    expect(store.get().background).toMatchObject({ imagePath: wall, blurPx: 10 })
  })

  it('update 写盘失败：内存保持改之前的值、不回调；之后别的变更落盘也不会把没写进去的补丁带进文件', async () => {
    const received: Settings[] = []
    const store = new SettingsStore(dir, {
      seedCommands: ['claude'],
      onChanged: (settings) => received.push(settings),
    })
    await store.load()
    const before = store.get()
    const file = join(dir, 'settings.json')
    chmodSync(file, 0o444) // 只读：原子写最后一步 rename 覆盖它时 EPERM，原内容保留
    try {
      await expect(
        store.update({ background: { ...before.background, imagePath: 'D:/bg.png' } }),
      ).rejects.toThrow(/EPERM/)
    } finally {
      chmodSync(file, 0o666)
    }
    expect(store.get()).toEqual(before)
    expect(received).toEqual([])

    await store.update({ launchCommands: [] })
    expect(JSON.parse(readFileSync(file, 'utf8')).background.imagePath).toBeNull()
  })

  describe('全局快捷键（可选字段 globalShortcut，settings.json 仍为 v2）', () => {
    const readFile = () => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))

    it('缺省（文件里没有这个键）= 开启 + Ctrl+Alt+T', async () => {
      const store = new SettingsStore(dir, { seedCommands: [] })
      await store.load()
      expect(store.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+T' })
      expect('globalShortcut' in readFile()).toBe(false)
      expect(readFile().version).toBe(2)
    })

    it('setGlobalShortcut 落盘并回调全量设置，重启后仍在；改回缺省值时删掉这个键；改唤起命令不动它', async () => {
      const received: Settings[] = []
      const store = new SettingsStore(dir, {
        seedCommands: ['claude'],
        onChanged: (settings) => received.push(settings),
      })
      await store.load()

      await store.setGlobalShortcut({ enabled: false, accelerator: 'Ctrl+Shift+F9' })
      expect(readFile().globalShortcut).toEqual({ enabled: false, accelerator: 'Ctrl+Shift+F9' })
      expect(received.at(-1)?.globalShortcut).toEqual({
        enabled: false,
        accelerator: 'Ctrl+Shift+F9',
      })

      await store.update({ launchCommands: [] })
      expect(store.getGlobalShortcut()).toEqual({ enabled: false, accelerator: 'Ctrl+Shift+F9' })

      const reloaded = new SettingsStore(dir, { seedCommands: [] })
      await reloaded.load()
      expect(reloaded.getGlobalShortcut()).toEqual({
        enabled: false,
        accelerator: 'Ctrl+Shift+F9',
      })

      await reloaded.setGlobalShortcut({ enabled: true, accelerator: 'Ctrl+Alt+T' })
      expect('globalShortcut' in readFile()).toBe(false)
      expect(reloaded.get().globalShortcut).toBeUndefined()
    })

    it('写盘失败：内存保持改之前的值（之后别的变更落盘也不会把没写进去的键位带进文件）', async () => {
      const received: Settings[] = []
      const store = new SettingsStore(dir, {
        seedCommands: ['claude'],
        onChanged: (settings) => received.push(settings),
      })
      await store.load()
      const file = join(dir, 'settings.json')
      chmodSync(file, 0o444) // 只读：原子写最后一步 rename 覆盖它时 EPERM，原内容保留
      try {
        await expect(
          store.setGlobalShortcut({ enabled: true, accelerator: 'Ctrl+Alt+Y' }),
        ).rejects.toThrow(/EPERM/)
      } finally {
        chmodSync(file, 0o666)
      }
      expect(store.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+T' })
      expect(store.get().globalShortcut).toBeUndefined()
      expect(received).toEqual([])

      await store.update({ launchCommands: [] })
      expect('globalShortcut' in readFile()).toBe(false)
    })

    it('文件里的 globalShortcut 不合法（键位串不对、enabled 不是布尔）：当缺省处理，不拒绝加载', async () => {
      for (const bad of [
        { enabled: true, accelerator: 'T' },
        { enabled: 'yes', accelerator: 'Ctrl+Alt+T' },
        'Ctrl+Alt+T',
      ]) {
        writeFileSync(
          join(dir, 'settings.json'),
          JSON.stringify({ version: 2, launchCommands: [], globalShortcut: bad }),
        )
        const store = new SettingsStore(dir, { seedCommands: [] })
        await store.load()
        expect(store.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+T' })
      }
    })
  })
})
