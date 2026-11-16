import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoWindow } from '../../src/main/memo/MemoWindow'
import { createFakeMemoWindowPort, type FakeMemoWindowPort } from './fakeMemoWindowPort'

// memo-floating-window 决策 2 / 3：小窗服务 —— 第一次打开才建窗口、关掉只隐藏；热键三种动作；位置记在 memo-window.json
let dir: string
let port: FakeMemoWindowPort

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tagterm-memo-window-'))
  port = createFakeMemoWindowPort()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

async function loaded(): Promise<MemoWindow> {
  const w = new MemoWindow({ port, dataDir: dir })
  await w.load()
  return w
}

const fileOf = (): string => join(dir, 'memo-window.json')
async function savedFile(): Promise<unknown> {
  return JSON.parse(await readFile(fileOf(), 'utf8'))
}

describe('MemoWindow：开关', () => {
  it('从没打开过就不建窗口；第一次打开才建，放在默认位置并聚焦', async () => {
    const memo = await loaded()
    expect(port.windows).toHaveLength(0)
    expect(memo.isOpen()).toBe(false)
    expect(memo.press()).toBe('open')
    expect(port.windows).toHaveLength(1)
    const win = port.windows[0]!
    expect(win.bounds).toEqual({ x: 1920 - 16 - 360, y: 16, width: 360, height: 520 })
    expect(win.calls).toEqual(['show'])
    expect(memo.isOpen()).toBe(true)
  })

  it('热键：焦点在小窗里再按 → 关掉（只隐藏，不销毁）；再按 → 复用同一个窗口打开', async () => {
    const memo = await loaded()
    memo.press()
    expect(memo.press()).toBe('close')
    expect(memo.isOpen()).toBe(false)
    expect(memo.press()).toBe('open')
    expect(port.windows).toHaveLength(1)
    expect(port.windows[0]!.calls).toEqual(['show', 'hide', 'show'])
  })

  it('热键：开着但焦点在别处 → 只把焦点交给小窗，并让它聚焦输入框', async () => {
    const memo = await loaded()
    memo.press()
    const win = port.windows[0]!
    win.focused = false // 用户点回了终端
    expect(memo.press()).toBe('focus')
    expect(win.visible).toBe(true)
    expect(win.calls.at(-1)).toBe('focus')
    expect(win.sent.at(-1)).toEqual({ channel: 'memo-window:focus-input', args: [] })
  })

  it('已建过的窗口再次打开时让它聚焦输入框（第一次建的由页面挂载时自己聚焦）', async () => {
    const memo = await loaded()
    memo.press()
    expect(port.windows[0]!.sent).toEqual([])
    memo.close()
    memo.press()
    expect(port.windows[0]!.sent).toEqual([{ channel: 'memo-window:focus-input', args: [] }])
  })

  it('左栏按钮：没开就打开、开着就关掉（不看焦点）', async () => {
    const memo = await loaded()
    memo.toggle()
    expect(memo.isOpen()).toBe(true)
    port.windows[0]!.focused = false
    memo.toggle()
    expect(memo.isOpen()).toBe(false)
  })

  it('托盘：打开并聚焦；已经开着也只是聚焦，不关', async () => {
    const memo = await loaded()
    memo.open()
    port.windows[0]!.focused = false
    memo.open()
    expect(memo.isOpen()).toBe(true)
    expect(port.windows[0]!.focused).toBe(true)
  })

  it('启动时打开：显示但不抢焦点', async () => {
    const memo = await loaded()
    memo.open({ focus: false })
    expect(port.windows[0]!.calls).toEqual(['showInactive'])
    expect(port.windows[0]!.focused).toBe(false)
  })

  it('系统的关闭请求（Alt+F4）= 关掉，只隐藏', async () => {
    const memo = await loaded()
    memo.open()
    port.windows[0]!.requestClose()
    expect(memo.isOpen()).toBe(false)
    expect(port.windows[0]!.calls.at(-1)).toBe('hide')
  })

  it('事件只发给建过的小窗：没建过时什么也不做', async () => {
    const memo = await loaded()
    memo.send('memo:changed', [])
    memo.open()
    memo.send('memo:changed', [])
    expect(port.windows[0]!.sent).toEqual([{ channel: 'memo:changed', args: [[]] }])
  })
})

describe('MemoWindow：位置记忆（memo-window.json v1）', () => {
  it('拖动 / 拉伸结束与关掉时写入位置和大小', async () => {
    const memo = await loaded()
    memo.open()
    port.windows[0]!.moveTo({ x: 200, y: 120, width: 400, height: 600 })
    await memo.flush()
    expect(await savedFile()).toEqual({
      version: 1,
      bounds: { x: 200, y: 120, width: 400, height: 600 },
    })
    port.windows[0]!.bounds = { x: 210, y: 130, width: 400, height: 600 }
    memo.close()
    await memo.flush()
    expect(await savedFile()).toEqual({
      version: 1,
      bounds: { x: 210, y: 130, width: 400, height: 600 },
    })
  })

  it('重启后第一次打开回到记住的位置', async () => {
    await writeFile(
      fileOf(),
      JSON.stringify({ version: 1, bounds: { x: 300, y: 200, width: 380, height: 560 } }),
    )
    const memo = await loaded()
    memo.open()
    expect(port.windows[0]!.bounds).toEqual({ x: 300, y: 200, width: 380, height: 560 })
  })

  it('记住的那块屏幕拔掉了 → 挪回主窗口所在屏幕', async () => {
    await writeFile(
      fileOf(),
      JSON.stringify({ version: 1, bounds: { x: 2400, y: 200, width: 380, height: 560 } }),
    )
    const memo = await loaded()
    memo.open()
    expect(port.windows[0]!.bounds).toEqual({ x: 1920 - 16 - 380, y: 16, width: 380, height: 560 })
  })

  it('文件坏了（坏 JSON / 版本不认识）→ 不抛，用默认位置并记一条 [memo] 警告', async () => {
    for (const text of ['{ 坏', JSON.stringify({ version: 9, bounds: {} })]) {
      await writeFile(fileOf(), text)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const fresh = createFakeMemoWindowPort()
      const memo = new MemoWindow({ port: fresh, dataDir: dir })
      await expect(memo.load()).resolves.toBeUndefined()
      memo.open()
      expect(fresh.windows[0]!.bounds).toEqual({
        x: 1920 - 16 - 360,
        y: 16,
        width: 360,
        height: 520,
      })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[memo]'))
      warn.mockRestore()
    }
  })

  it('文件不存在 → 默认位置，不记警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const memo = await loaded()
    memo.open()
    expect(warn).not.toHaveBeenCalled()
  })
})
