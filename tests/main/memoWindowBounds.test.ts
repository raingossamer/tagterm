import { describe, expect, it } from 'vitest'
import {
  parseMemoWindowFile,
  placeMemoWindow,
  type Rect,
} from '../../src/main/memo/memoWindowBounds'

// memo-floating-window 决策 3：默认 360×520、主窗口所在屏幕工作区右上角离边 16；记住的位置越界就挪回来
const main: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const second: Rect = { x: 1920, y: 0, width: 1600, height: 860 }

describe('placeMemoWindow（小窗放在哪、多大）', () => {
  it('没记过位置 → 主窗口所在屏幕工作区的右上角，离边 16，360×520', () => {
    expect(placeMemoWindow({ saved: null, workAreas: [main, second], mainArea: main })).toEqual({
      x: 1920 - 16 - 360,
      y: 16,
      width: 360,
      height: 520,
    })
  })

  it('主窗口在第二块屏幕上 → 放在那块屏幕的右上角', () => {
    expect(placeMemoWindow({ saved: null, workAreas: [main, second], mainArea: second })).toEqual({
      x: 1920 + 1600 - 16 - 360,
      y: 16,
      width: 360,
      height: 520,
    })
  })

  it('工作区比默认大小还矮 → 高度收进工作区（不小于最小 260）', () => {
    const short: Rect = { x: 0, y: 0, width: 1280, height: 400 }
    expect(placeMemoWindow({ saved: null, workAreas: [short], mainArea: short }).height).toBe(
      400 - 32,
    )
  })

  it('记住的位置在某块屏幕里 → 原样回到那里（含第二块屏幕）', () => {
    const saved = { x: 2400, y: 300, width: 420, height: 600 }
    expect(placeMemoWindow({ saved, workAreas: [main, second], mainArea: main })).toEqual(saved)
  })

  it('一部分出了屏幕、但标题栏还抓得到 → 不动', () => {
    const saved = { x: 1800, y: 900, width: 360, height: 520 }
    expect(placeMemoWindow({ saved, workAreas: [main], mainArea: main })).toEqual(saved)
  })

  it('记住的那块屏幕拔掉了（标题栏不在任何工作区里）→ 挪回主窗口所在屏幕的右上角，大小照旧', () => {
    const saved = { x: 2400, y: 300, width: 420, height: 600 }
    expect(placeMemoWindow({ saved, workAreas: [main], mainArea: main })).toEqual({
      x: 1920 - 16 - 420,
      y: 16,
      width: 420,
      height: 600,
    })
  })

  it('标题栏跑到屏幕上沿之外（抓不到）→ 挪回来', () => {
    const saved = { x: 400, y: -200, width: 360, height: 520 }
    const placed = placeMemoWindow({ saved, workAreas: [main], mainArea: main })
    expect(placed.y).toBe(16)
  })

  it('记住的大小比最小值还小 → 放大到最小 300×260', () => {
    const saved = { x: 100, y: 100, width: 120, height: 80 }
    expect(placeMemoWindow({ saved, workAreas: [main], mainArea: main })).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 260,
    })
  })
})

describe('parseMemoWindowFile（memo-window.json v1：坏了就当没记过）', () => {
  it('合法文件 → 位置与大小', () => {
    expect(
      parseMemoWindowFile({ version: 1, bounds: { x: -1200, y: 40, width: 380, height: 560 } }),
    ).toEqual({ x: -1200, y: 40, width: 380, height: 560 })
  })

  it('版本不认识、缺字段、不是整数、宽高不是正数、根本不是对象 → null', () => {
    for (const raw of [
      { version: 2, bounds: { x: 0, y: 0, width: 360, height: 520 } },
      { version: 1 },
      { version: 1, bounds: { x: 0, y: 0, width: '360', height: 520 } },
      { version: 1, bounds: { x: 0.5, y: 0, width: 360, height: 520 } },
      { version: 1, bounds: { x: 0, y: 0, width: 0, height: 520 } },
      [],
      'x',
      null,
    ])
      expect(parseMemoWindowFile(raw)).toBeNull()
  })
})
