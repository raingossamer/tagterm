import { describe, expect, it } from 'vitest'
import { captureAccelerator } from '../../src/renderer/src/composables/shortcutCapture'

function key(over: Partial<Parameters<typeof captureAccelerator>[0]>) {
  return {
    key: 't',
    code: 'KeyT',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...over,
  }
}

describe('captureAccelerator（设置里录制全局快捷键：按下的组合 → 键位串）', () => {
  it('Ctrl / Alt / Shift + 字母 / 数字 / F1–F12 → 规范写法；按物理键取名，Shift 不影响（Shift+1 仍是 1）', () => {
    expect(captureAccelerator(key({ ctrlKey: true, altKey: true }))).toEqual({
      kind: 'accelerator',
      value: 'Ctrl+Alt+T',
    })
    expect(
      captureAccelerator(key({ key: '!', code: 'Digit1', altKey: true, shiftKey: true })),
    ).toEqual({ kind: 'accelerator', value: 'Alt+Shift+1' })
    expect(captureAccelerator(key({ key: 'F5', code: 'F5', ctrlKey: true }))).toEqual({
      kind: 'accelerator',
      value: 'Ctrl+F5',
    })
  })

  it('只按着修饰键 → 还在等（继续录）', () => {
    for (const k of ['Control', 'Alt', 'Shift', 'Meta'])
      expect(
        captureAccelerator(key({ key: k, code: `${k}Left`, ctrlKey: k === 'Control' })),
      ).toEqual({
        kind: 'pending',
      })
  })

  it('不含 Ctrl 或 Alt、带 Win 键、不支持的键 → 不合法（界面给提示）', () => {
    expect(captureAccelerator(key({}))).toEqual({ kind: 'invalid' })
    expect(captureAccelerator(key({ shiftKey: true }))).toEqual({ kind: 'invalid' })
    expect(captureAccelerator(key({ ctrlKey: true, metaKey: true }))).toEqual({ kind: 'invalid' })
    expect(captureAccelerator(key({ key: ' ', code: 'Space', ctrlKey: true }))).toEqual({
      kind: 'invalid',
    })
    expect(captureAccelerator(key({ key: '5', code: 'Numpad5', ctrlKey: true }))).toEqual({
      kind: 'invalid',
    })
  })
})
