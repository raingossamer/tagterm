import { describe, expect, it } from 'vitest'
import { decideMemoToggle } from '../../src/main/shortcut/memoToggle'

// memo-floating-window 决策 2：备忘录热键只管备忘小窗，不碰主窗口；「记完就回去」= 焦点在小窗里再按就关掉
// （旧语义「关掉并把主窗口藏回托盘」与渲染进程回报开关的 MemoToggle 按用户判定取消）
describe('decideMemoToggle（备忘录热键：打开、只聚焦，还是关掉）', () => {
  it('小窗没开 → 打开', () => {
    expect(decideMemoToggle({ isOpen: false, isFocused: false })).toBe('open')
  })

  it('小窗开着但焦点在别处（如正在终端里打字）→ 只把焦点交给小窗，不关', () => {
    expect(decideMemoToggle({ isOpen: true, isFocused: false })).toBe('focus')
  })

  it('小窗开着且焦点在小窗里 → 关掉', () => {
    expect(decideMemoToggle({ isOpen: true, isFocused: true })).toBe('close')
  })
})
