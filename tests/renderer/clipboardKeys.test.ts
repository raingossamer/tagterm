import { describe, expect, it } from 'vitest'
import {
  clipboardActionForRightClick,
  terminalKeyAction,
} from '../../src/renderer/src/terminal/clipboardKeys'

function key(
  partial: Partial<KeyboardEvent> & { key: string },
  type: 'keydown' | 'keyup' | 'keypress' = 'keydown',
) {
  return { type, ctrlKey: false, shiftKey: false, altKey: false, ...partial }
}

describe('terminalKeyAction（Windows 终端习惯 + 全局搜索键）', () => {
  it('Ctrl+K 归 search：无论有无选区、是否按 Shift；Alt 组合不算', () => {
    expect(terminalKeyAction(key({ key: 'k', ctrlKey: true }), false)).toBe('search')
    expect(terminalKeyAction(key({ key: 'K', ctrlKey: true, shiftKey: true }), true)).toBe('search')
    expect(terminalKeyAction(key({ key: 'k', ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(terminalKeyAction(key({ key: 'k' }), false)).toBeNull()
  })

  it('Ctrl+V、Ctrl+Shift+V、Shift+Insert 都是粘贴', () => {
    expect(terminalKeyAction(key({ key: 'v', ctrlKey: true }), false)).toBe('paste')
    expect(terminalKeyAction(key({ key: 'V', ctrlKey: true, shiftKey: true }), false)).toBe('paste')
    expect(terminalKeyAction(key({ key: 'Insert', shiftKey: true }), false)).toBe('paste')
  })

  it('Ctrl+Shift+C 复制；Ctrl+C 有选区时复制、无选区时交给终端（中断）', () => {
    expect(terminalKeyAction(key({ key: 'C', ctrlKey: true, shiftKey: true }), false)).toBe('copy')
    expect(terminalKeyAction(key({ key: 'c', ctrlKey: true }), true)).toBe('copy')
    expect(terminalKeyAction(key({ key: 'c', ctrlKey: true }), false)).toBeNull()
  })

  it('Ctrl+Shift+F 归 find（终端内搜索，不写进 shell）；Ctrl+F 不带 Shift 照常交给终端程序', () => {
    expect(terminalKeyAction(key({ key: 'F', ctrlKey: true, shiftKey: true }), false)).toBe('find')
    expect(terminalKeyAction(key({ key: 'F', ctrlKey: true, shiftKey: true }), true)).toBe('find')
    expect(terminalKeyAction(key({ key: 'f', ctrlKey: true }), false)).toBeNull()
    expect(terminalKeyAction(key({ key: 'F', shiftKey: true }), false)).toBeNull()
  })

  it('Ctrl+0（主键盘或小键盘）归 font-reset：字号回到默认；不带 Ctrl 的 0 照常输入', () => {
    expect(terminalKeyAction(key({ key: '0', ctrlKey: true }), false)).toBe('font-reset')
    expect(terminalKeyAction(key({ key: '0', ctrlKey: true }), true)).toBe('font-reset')
    expect(terminalKeyAction(key({ key: '0' }), false)).toBeNull()
    expect(terminalKeyAction(key({ key: '0', ctrlKey: true, altKey: true }), false)).toBeNull()
  })

  it('其他按键、带 Alt 的组合、非 keydown 事件都不处理', () => {
    expect(terminalKeyAction(key({ key: 'v' }), false)).toBeNull()
    expect(terminalKeyAction(key({ key: 'v', ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(terminalKeyAction(key({ key: 'v', ctrlKey: true }, 'keyup'), false)).toBeNull()
    expect(terminalKeyAction(key({ key: 'a', ctrlKey: true }), true)).toBeNull()
  })
})

describe('clipboardActionForRightClick', () => {
  it('无鼠标追踪时：有选区复制，无选区粘贴', () => {
    expect(clipboardActionForRightClick(true)).toBe('copy')
    expect(clipboardActionForRightClick(false)).toBe('paste')
  })

  it('程序开了鼠标追踪：右键让给程序（返回 null，不复制不粘贴），避免与程序自身右键粘贴叠成两遍', () => {
    expect(clipboardActionForRightClick(false, true)).toBeNull()
    expect(clipboardActionForRightClick(true, true)).toBeNull()
  })

  it('鼠标追踪下按 Shift 强制走终端：仍按有无选区决定复制 / 粘贴', () => {
    expect(clipboardActionForRightClick(false, true, true)).toBe('paste')
    expect(clipboardActionForRightClick(true, true, true)).toBe('copy')
  })
})
