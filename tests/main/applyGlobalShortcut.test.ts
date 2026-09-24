import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GlobalShortcut } from '../../src/main/shortcut/GlobalShortcut'
import { applyGlobalShortcut } from '../../src/main/shortcut/applyGlobalShortcut'
import { SettingsStore } from '../../src/main/store/SettingsStore'
import { FakeShortcutPort } from './fakeShortcutPort'

// 「先向系统注册、成功才落盘、落盘失败换回旧的」：接口层 app:set-global-shortcut 与配置导入共用的一个函数
describe('applyGlobalShortcut', () => {
  let dir: string
  let port: FakeShortcutPort
  let shortcut: GlobalShortcut
  let settings: SettingsStore
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-apply-shortcut-'))
    port = new FakeShortcutPort()
    shortcut = new GlobalShortcut({ port, onPress: () => {} })
    settings = new SettingsStore(dir, { seedCommands: [] })
    await settings.load()
    shortcut.start(settings.getGlobalShortcut())
  })
  afterEach(() => {
    shortcut.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('先注册新键位，成功才写 settings.json，返回新状态', async () => {
    await expect(
      applyGlobalShortcut({ shortcut, settings }, { enabled: true, accelerator: 'Ctrl+Alt+Y' }),
    ).resolves.toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Y', registered: true })
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+Y'])
    expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Y' })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).globalShortcut).toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+Y',
    })
  })

  it('新键位被别的程序占着：reject「该快捷键已被其他程序占用」，旧键位照旧、不落盘', async () => {
    port.occupied.add('Alt+F9')
    await expect(
      applyGlobalShortcut({ shortcut, settings }, { enabled: true, accelerator: 'Alt+F9' }),
    ).rejects.toThrow('该快捷键已被其他程序占用')
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+T'])
    expect(settings.get().globalShortcut).toBeUndefined()
  })

  it('落盘失败：系统注册与内存里的设置都回到调用前，错误原样抛', async () => {
    const file = join(dir, 'settings.json')
    chmodSync(file, 0o444) // 只读：原子写最后一步 rename 覆盖它时 EPERM，原内容保留
    try {
      await expect(
        applyGlobalShortcut({ shortcut, settings }, { enabled: true, accelerator: 'Ctrl+Alt+Y' }),
      ).rejects.toThrow(/EPERM/)
    } finally {
      chmodSync(file, 0o666)
    }
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+T'])
    expect(shortcut.status()).toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+T',
      registered: true,
    })
    expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+T' })
  })
})
