import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalShortcut } from '../../src/main/shortcut/GlobalShortcut'
import { FakeShortcutPort } from './fakeShortcutPort'

describe('GlobalShortcut（全局快捷键服务，系统热键以命名端口注入）', () => {
  let port: FakeShortcutPort
  let presses: number
  let shortcut: GlobalShortcut

  beforeEach(() => {
    port = new FakeShortcutPort()
    presses = 0
    shortcut = new GlobalShortcut({ port, onPress: () => (presses += 1) })
  })

  it('start：开启时注册键位，按下即回调；状态 registered 为真', () => {
    shortcut.start({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+T'])
    port.press('Ctrl+Alt+T')
    expect(presses).toBe(1)
    expect(shortcut.status()).toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+T',
      registered: true,
    })
  })

  it('start：键位被别的程序占着 → 不抛、只记一行日志，状态 registered 为假（设置里显示红字）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    port.occupied.add('Ctrl+Alt+T')
    shortcut.start({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    expect(shortcut.status()).toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+T',
      registered: false,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('[shortcut]')
    warn.mockRestore()
  })

  it('start：关闭时不注册', () => {
    shortcut.start({ enabled: false, accelerator: 'Ctrl+Alt+T' })
    expect(port.registered.size).toBe(0)
    expect(shortcut.status().registered).toBe(false)
  })

  it('apply 换键位：先注册新的，成功才注销旧的；新的被占用 → 返回 false，旧的照旧可用、配置不变', () => {
    shortcut.start({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    expect(shortcut.apply({ enabled: true, accelerator: 'Ctrl+Alt+Y' })).toBe(true)
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+Y'])

    port.occupied.add('Alt+F9')
    expect(shortcut.apply({ enabled: true, accelerator: 'Alt+F9' })).toBe(false)
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+Y'])
    expect(shortcut.status()).toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+Y',
      registered: true,
    })
  })

  it('apply 关闭 → 注销；再开启同一键位 → 重新注册；键位没变且已注册 → 什么都不动', () => {
    shortcut.start({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    expect(shortcut.apply({ enabled: false, accelerator: 'Ctrl+Alt+T' })).toBe(true)
    expect(port.registered.size).toBe(0)
    expect(shortcut.status()).toEqual({
      enabled: false,
      accelerator: 'Ctrl+Alt+T',
      registered: false,
    })

    expect(shortcut.apply({ enabled: true, accelerator: 'Ctrl+Alt+T' })).toBe(true)
    expect(shortcut.apply({ enabled: true, accelerator: 'Ctrl+Alt+T' })).toBe(true)
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+T'])
  })

  it('启动时没注册上的键位，之后在设置里再提交一次（占用的程序已退出）→ 重新注册', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    port.occupied.add('Ctrl+Alt+T')
    shortcut.start({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    port.occupied.clear()
    expect(shortcut.apply({ enabled: true, accelerator: 'Ctrl+Alt+T' })).toBe(true)
    expect(shortcut.status().registered).toBe(true)
    vi.restoreAllMocks()
  })

  it('pause（设置里录新键位期间）先注销，免得按到旧键把窗口藏掉；resume 注册回来；暂停中 apply 先恢复再换', () => {
    shortcut.start({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    shortcut.pause()
    expect(port.registered.size).toBe(0)
    port.press('Ctrl+Alt+T')
    expect(presses).toBe(0)
    expect(shortcut.status().registered).toBe(true) // 暂停不算「没注册上」，设置里不显示红字
    shortcut.resume()
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+T'])

    shortcut.pause()
    expect(shortcut.apply({ enabled: true, accelerator: 'Ctrl+Alt+K' })).toBe(true)
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+K'])
    shortcut.resume()
    expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+K'])
  })

  it('dispose 注销（退出时）', () => {
    shortcut.start({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    shortcut.dispose()
    expect(port.registered.size).toBe(0)
  })
})
