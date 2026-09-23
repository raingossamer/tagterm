import { describe, expect, it } from 'vitest'
import { decideSummon } from '../../src/main/shortcut/summon'

describe('decideSummon（全局快捷键：唤出还是藏起窗口）', () => {
  it('窗口可见、没最小化、且在前台 → 藏到托盘', () => {
    expect(decideSummon({ isVisible: true, isMinimized: false, isFocused: true })).toBe('hide')
  })

  it('隐藏在托盘、最小化、或被别的窗口挡在后面 → 唤出（还原 + 显示 + 聚焦）', () => {
    expect(decideSummon({ isVisible: false, isMinimized: false, isFocused: false })).toBe('show')
    expect(decideSummon({ isVisible: true, isMinimized: true, isFocused: false })).toBe('show')
    expect(decideSummon({ isVisible: true, isMinimized: false, isFocused: false })).toBe('show')
    // 最小化时 Windows 仍可能报告聚焦：以最小化为准
    expect(decideSummon({ isVisible: true, isMinimized: true, isFocused: true })).toBe('show')
  })
})
