import { describe, expect, it } from 'vitest'
import { decideMemoToggle, MemoToggle } from '../../src/main/shortcut/memoToggle'

const front = { isVisible: true, isMinimized: false, isFocused: true }
const hidden = { isVisible: false, isMinimized: false, isFocused: false }
const behind = { isVisible: true, isMinimized: false, isFocused: false }

describe('decideMemoToggle（备忘录热键：开、关，还是关掉并藏回去）', () => {
  it('备忘录没开 → 打开（不管窗口在哪）', () => {
    for (const win of [front, hidden, behind])
      expect(decideMemoToggle({ ...win, memoOpen: false, summonedFromBackground: false })).toBe(
        'open',
      )
  })

  it('开着且窗口在前台 → 关；是热键从后台叫出来的 → 关掉并藏回去', () => {
    expect(decideMemoToggle({ ...front, memoOpen: true, summonedFromBackground: false })).toBe(
      'close',
    )
    expect(decideMemoToggle({ ...front, memoOpen: true, summonedFromBackground: true })).toBe(
      'close-and-hide',
    )
  })

  it('开着但窗口在后台 / 藏着 / 最小化 → 先把它叫到前面（仍算打开）', () => {
    for (const win of [hidden, behind, { ...front, isMinimized: true }])
      expect(decideMemoToggle({ ...win, memoOpen: true, summonedFromBackground: false })).toBe(
        'open',
      )
  })
})

describe('MemoToggle（记住备忘录开着没有、这次是不是热键从后台叫出来的）', () => {
  it('记完就回去：从托盘按 → 打开；在前台再按 → 关掉并藏回去', () => {
    const toggle = new MemoToggle()
    expect(toggle.press(hidden)).toBe('open')
    toggle.visibilityChanged(true)
    expect(toggle.press(front)).toBe('close-and-hide')
    toggle.visibilityChanged(false)
    expect(toggle.press(front)).toBe('open')
  })

  it('窗口本来就在前台时打开的，再按只关不藏', () => {
    const toggle = new MemoToggle()
    expect(toggle.press(front)).toBe('open')
    toggle.visibilityChanged(true)
    expect(toggle.press(front)).toBe('close')
  })

  it('用 Esc / 遮罩 / 按钮关掉（渲染进程报关）后，「从后台叫出来」作废：下次在前台打开再按只关不藏', () => {
    const toggle = new MemoToggle()
    toggle.press(behind)
    toggle.visibilityChanged(true)
    toggle.visibilityChanged(false)
    expect(toggle.press(front)).toBe('open')
    toggle.visibilityChanged(true)
    expect(toggle.press(front)).toBe('close')
  })

  it('点左栏按钮 / 托盘菜单打开的（渲染进程报开）：在前台按热键只关不藏', () => {
    const toggle = new MemoToggle()
    toggle.visibilityChanged(true)
    expect(toggle.press(front)).toBe('close')
  })

  it('连按两下不等渲染进程回报：第二下按刚做出的决定判断', () => {
    const toggle = new MemoToggle()
    expect(toggle.press(hidden)).toBe('open')
    expect(toggle.press(front)).toBe('close-and-hide')
    expect(toggle.press(front)).toBe('open')
  })
})
