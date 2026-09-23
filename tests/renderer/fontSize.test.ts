import { describe, expect, it } from 'vitest'
import {
  clampFontSize,
  createWheelZoom,
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseFontSize,
} from '../../src/renderer/src/terminal/fontSize'

describe('终端字号的范围', () => {
  it('默认 14，范围 10–32', () => {
    expect(DEFAULT_FONT_SIZE).toBe(14)
    expect(MIN_FONT_SIZE).toBe(10)
    expect(MAX_FONT_SIZE).toBe(32)
  })

  it('夹紧到范围内并取整；不是有限数回落默认', () => {
    expect(clampFontSize(15)).toBe(15)
    expect(clampFontSize(9)).toBe(10)
    expect(clampFontSize(40)).toBe(32)
    expect(clampFontSize(15.6)).toBe(16)
    expect(clampFontSize(Number.NaN)).toBe(14)
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(14)
  })

  it('读本机偏好：合法数字照用（夹紧），缺失 / 坏值回落 14', () => {
    expect(parseFontSize('18')).toBe(18)
    expect(parseFontSize('99')).toBe(32)
    expect(parseFontSize(null)).toBe(14)
    expect(parseFontSize('')).toBe(14)
    expect(parseFontSize('大')).toBe(14)
    expect(parseFontSize('{"size":16}')).toBe(14)
  })
})

describe('Ctrl+滚轮的步数（createWheelZoom）', () => {
  it('鼠标一格（deltaY ±100）一步：往上滚变大、往下滚变小', () => {
    const zoom = createWheelZoom()
    expect(zoom.push(-100, 0)).toBe(1)
    expect(zoom.push(100, 0)).toBe(-1)
    expect(zoom.push(-300, 0)).toBe(3)
  })

  it('触摸板的小增量累积够一格才动，余数留给下一次', () => {
    const zoom = createWheelZoom()
    expect(zoom.push(-40, 0)).toBe(0)
    expect(zoom.push(-40, 0)).toBe(0)
    expect(zoom.push(-40, 0)).toBe(1)
    expect(zoom.push(-80, 0)).toBe(1)
  })

  it('按行滚动的鼠标（deltaMode 1，一格约 3 行）同样一格一步', () => {
    const zoom = createWheelZoom()
    expect(zoom.push(-3, 1)).toBe(1)
    expect(zoom.push(3, 1)).toBe(-1)
  })

  it('按页滚动（deltaMode 2）一页一步', () => {
    const zoom = createWheelZoom()
    expect(zoom.push(1, 2)).toBe(-1)
  })

  it('反向滚动先抵消攒着的余数', () => {
    const zoom = createWheelZoom()
    expect(zoom.push(-60, 0)).toBe(0)
    expect(zoom.push(50, 0)).toBe(0)
    expect(zoom.push(-90, 0)).toBe(1)
  })
})
