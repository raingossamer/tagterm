/**
 * 设置里录制全局快捷键（纯函数）：把一次按键换成键位串（`Ctrl+Alt+T`）。
 * 键名取物理键（event.code）而不是 event.key：按着 Shift 时 key 会变成符号（Shift+1 → '!'）。
 */
import { isValidAccelerator } from '@shared/accelerator'

export interface CaptureKey {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** accelerator = 录到了合法组合；pending = 只按着修饰键、继续等；invalid = 这个组合不能用（界面提示规则） */
export type CaptureResult =
  { kind: 'accelerator'; value: string } | { kind: 'pending' } | { kind: 'invalid' }

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

/** 物理键 → 键位串里的键名；小键盘数字、空格、符号键等不支持，为 null */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]!
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]!
  return /^F([1-9]|1[0-2])$/.test(code) ? code : null
}

export function captureAccelerator(e: CaptureKey): CaptureResult {
  if (MODIFIER_KEYS.has(e.key)) return { kind: 'pending' }
  if (e.metaKey) return { kind: 'invalid' }
  const name = keyName(e.code)
  if (name === null) return { kind: 'invalid' }
  const value = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', name]
    .filter(Boolean)
    .join('+')
  return isValidAccelerator(value) ? { kind: 'accelerator', value } : { kind: 'invalid' }
}
