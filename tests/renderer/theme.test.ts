import { describe, expect, it } from 'vitest'
import { buildTerminalOptions, CAMPBELL_THEME } from '../../src/renderer/src/terminal/theme'

describe('终端默认选项', () => {
  it('滚动条滑块三态全透明：看不见，但回滚缓冲与滚轮照常', () => {
    expect(CAMPBELL_THEME.scrollbarSliderBackground).toBe('#00000000')
    expect(CAMPBELL_THEME.scrollbarSliderHoverBackground).toBe('#00000000')
    expect(CAMPBELL_THEME.scrollbarSliderActiveBackground).toBe('#00000000')

    // scrollback 必须保留：置 0 才能让 FitAddon 不扣那 14px，但那样就再也滚不上去了
    expect(buildTerminalOptions(26200).scrollback).toBe(5000)
  })

  it('光标仍是竖线（聚焦与失焦都是），背景仍透明', () => {
    const opts = buildTerminalOptions(26200)
    expect(opts.cursorStyle).toBe('bar')
    expect(opts.cursorInactiveStyle).toBe('bar')
    expect(CAMPBELL_THEME.background).toBe('#0C0C0C00')
  })
})
