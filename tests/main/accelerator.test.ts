import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOBAL_SHORTCUT, isValidAccelerator } from '@shared/accelerator'

describe('全局快捷键键位串（shared，主进程守卫与渲染进程录制共用）', () => {
  it('缺省 Ctrl+Alt+T，且本身合法', () => {
    expect(DEFAULT_GLOBAL_SHORTCUT).toBe('Ctrl+Alt+T')
    expect(isValidAccelerator(DEFAULT_GLOBAL_SHORTCUT)).toBe(true)
  })

  it('必须含 Ctrl 或 Alt，可加 Shift；键为字母 / 数字 / F1–F12；修饰键按 Ctrl、Alt、Shift 的顺序各出现一次', () => {
    for (const ok of ['Ctrl+T', 'Alt+1', 'Ctrl+Shift+F5', 'Ctrl+Alt+Shift+Z', 'Alt+F12', 'Ctrl+0'])
      expect(isValidAccelerator(ok), ok).toBe(true)
    for (const bad of [
      'T',
      'Shift+T',
      'F5',
      'Shift+F5',
      'Ctrl+',
      'Ctrl+Alt',
      'Ctrl+F13',
      'Ctrl+F0',
      'Ctrl+Space',
      'Ctrl+t',
      'Alt+Ctrl+T',
      'Ctrl+Ctrl+T',
      'Super+T',
      'Ctrl+Super+T',
      'CommandOrControl+T',
      '',
    ])
      expect(isValidAccelerator(bad), bad).toBe(false)
  })

  it('不是字符串一律不合法（主进程守卫直接用）', () => {
    expect(isValidAccelerator(null)).toBe(false)
    expect(isValidAccelerator(42)).toBe(false)
  })
})
