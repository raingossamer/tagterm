import { describe, expect, it } from 'vitest'
import { isDevToolsToggle } from '../../src/main/windowKeys'

const key = (over: Partial<Parameters<typeof isDevToolsToggle>[0]>) => ({
  type: 'keyDown',
  key: 'F12',
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...over,
})

describe('isDevToolsToggle（开发模式 F12 开关开发者工具）', () => {
  it('单按 F12 按下时为真', () => {
    expect(isDevToolsToggle(key({}))).toBe(true)
  })

  it('抬起、带修饰键、别的键都不算', () => {
    expect(isDevToolsToggle(key({ type: 'keyUp' }))).toBe(false)
    expect(isDevToolsToggle(key({ control: true }))).toBe(false)
    expect(isDevToolsToggle(key({ shift: true }))).toBe(false)
    expect(isDevToolsToggle(key({ alt: true }))).toBe(false)
    expect(isDevToolsToggle(key({ key: 'F11' }))).toBe(false)
    expect(isDevToolsToggle(key({ key: 'I', control: true, shift: true }))).toBe(false)
  })
})
