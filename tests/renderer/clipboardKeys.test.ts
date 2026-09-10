import { describe, expect, it } from 'vitest'
import {
  clipboardActionForKey,
  clipboardActionForRightClick,
} from '../../src/renderer/src/terminal/clipboardKeys'

function key(
  partial: Partial<KeyboardEvent> & { key: string },
  type: 'keydown' | 'keyup' | 'keypress' = 'keydown',
) {
  return { type, ctrlKey: false, shiftKey: false, altKey: false, ...partial }
}

describe('clipboardActionForKey（Windows 终端习惯）', () => {
  it('Ctrl+V、Ctrl+Shift+V、Shift+Insert 都是粘贴', () => {
    expect(clipboardActionForKey(key({ key: 'v', ctrlKey: true }), false)).toBe('paste')
    expect(clipboardActionForKey(key({ key: 'V', ctrlKey: true, shiftKey: true }), false)).toBe(
      'paste',
    )
    expect(clipboardActionForKey(key({ key: 'Insert', shiftKey: true }), false)).toBe('paste')
  })

  it('Ctrl+Shift+C 复制；Ctrl+C 有选区时复制、无选区时交给终端（中断）', () => {
    expect(clipboardActionForKey(key({ key: 'C', ctrlKey: true, shiftKey: true }), false)).toBe(
      'copy',
    )
    expect(clipboardActionForKey(key({ key: 'c', ctrlKey: true }), true)).toBe('copy')
    expect(clipboardActionForKey(key({ key: 'c', ctrlKey: true }), false)).toBeNull()
  })

  it('其他按键、带 Alt 的组合、非 keydown 事件都不处理', () => {
    expect(clipboardActionForKey(key({ key: 'v' }), false)).toBeNull()
    expect(clipboardActionForKey(key({ key: 'v', ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(clipboardActionForKey(key({ key: 'v', ctrlKey: true }, 'keyup'), false)).toBeNull()
    expect(clipboardActionForKey(key({ key: 'a', ctrlKey: true }), true)).toBeNull()
  })
})

describe('clipboardActionForRightClick', () => {
  it('有选区复制，无选区粘贴', () => {
    expect(clipboardActionForRightClick(true)).toBe('copy')
    expect(clipboardActionForRightClick(false)).toBe('paste')
  })
})
