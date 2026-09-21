import { describe, expect, it, vi } from 'vitest'
import { buildTrayMenuTemplate, createTrayBadge, trayTooltip } from '../../src/main/trayMenu'

describe('trayMenu（托盘菜单模板与角标，纯函数 + 假 Tray）', () => {
  it('菜单为「显示窗口 / — / 设置 / — / 退出」，点击各项调用对应回调', () => {
    const deps = { onShow: vi.fn(), onOpenSettings: vi.fn(), onQuit: vi.fn() }
    const template = buildTrayMenuTemplate(deps)

    expect(template.map((item) => item.label ?? item.type)).toEqual([
      '显示窗口',
      'separator',
      '设置',
      'separator',
      '退出',
    ])
    template[2]!.click!()
    expect(deps.onOpenSettings).toHaveBeenCalledTimes(1)
    template[0]!.click!()
    template[4]!.click!()
    expect(deps.onShow).toHaveBeenCalledTimes(1)
    expect(deps.onQuit).toHaveBeenCalledTimes(1)
  })

  it('trayTooltip：都为 0 是「TagTerm」；等你确认 > 已完成 > 运行中 三档各取其一', () => {
    expect(trayTooltip({ blocked: 0, working: 0, done: 0 })).toBe('TagTerm')
    expect(trayTooltip({ blocked: 2, working: 1, done: 1 })).toBe('TagTerm · 2 个会话等你确认')
    expect(trayTooltip({ blocked: 0, working: 3, done: 1 })).toBe('TagTerm · 1 个会话已完成')
    expect(trayTooltip({ blocked: 0, working: 3, done: 0 })).toBe('TagTerm · 3 个会话运行中')
  })

  it('setBadge：图按 等你确认（黄）> 已完成（蓝）> 运行中（绿）> 原图标；黄时每 500 ms 黄 ↔ 红交替，计数变化但仍黄不重启节拍、只换 tooltip；等你确认归 0 即停并落到该显示的图；三个计数都没变不重复设置；dispose 清定时器', () => {
    const calls: string[] = []
    const tray = {
      setImage: (img: string) => calls.push(`image:${img}`),
      setToolTip: (text: string) => calls.push(`tip:${text}`),
    }
    // 假定时器：记下节拍间隔与清除次数，tick() 手动触发一次
    let tickFn: (() => void) | null = null
    const intervals: number[] = []
    const cleared: unknown[] = []
    const timers = {
      setInterval: (fn: () => void, ms: number): unknown => {
        tickFn = fn
        intervals.push(ms)
        return intervals.length
      },
      clearInterval: (handle: unknown): void => {
        cleared.push(handle)
        tickFn = null
      },
    }
    const tick = (): void => tickFn?.()
    const badge = createTrayBadge(
      tray,
      {
        normal: 'normal.png',
        blocked: 'blocked.png',
        alert: 'alert.png',
        done: 'done.png',
        working: 'working.png',
      },
      timers,
    )

    badge.setBadge({ blocked: 0, working: 3, done: 0 })
    expect(calls).toEqual(['image:working.png', 'tip:TagTerm · 3 个会话运行中'])
    badge.setBadge({ blocked: 0, working: 3, done: 0 })
    expect(calls).toHaveLength(2)
    // 蓝优先于绿
    badge.setBadge({ blocked: 0, working: 3, done: 1 })
    expect(calls.slice(2)).toEqual(['image:done.png', 'tip:TagTerm · 1 个会话已完成'])
    expect(intervals).toEqual([])

    // 有人等你确认：黄图 + 起 500 ms 节拍，之后黄 ↔ 红交替
    badge.setBadge({ blocked: 2, working: 3, done: 1 })
    expect(calls.slice(4)).toEqual(['image:blocked.png', 'tip:TagTerm · 2 个会话等你确认'])
    expect(intervals).toEqual([500])
    tick()
    tick()
    expect(calls.slice(6)).toEqual(['image:alert.png', 'image:blocked.png'])
    // 计数变了但仍有人等：不重启节拍、不碰图，只换 tooltip；节拍照常继续
    badge.setBadge({ blocked: 1, working: 0, done: 1 })
    expect(calls.slice(8)).toEqual(['tip:TagTerm · 1 个会话等你确认'])
    expect(intervals).toEqual([500])
    tick()
    expect(calls.slice(9)).toEqual(['image:alert.png'])

    // 归 0：清定时器，立刻落到该显示的图（还有一个已完成 → 蓝）
    badge.setBadge({ blocked: 0, working: 0, done: 1 })
    expect(cleared).toEqual([1])
    expect(calls.slice(10)).toEqual(['image:done.png', 'tip:TagTerm · 1 个会话已完成'])
    badge.setBadge({ blocked: 0, working: 0, done: 0 })
    expect(calls.slice(12)).toEqual(['image:normal.png', 'tip:TagTerm'])
    expect(badge.counts()).toEqual({ blocked: 0, working: 0, done: 0 })

    // 再次有人等：重新起节拍；dispose 清掉（退出时不能挂着 interval）
    badge.setBadge({ blocked: 1, working: 0, done: 0 })
    expect(intervals).toEqual([500, 500])
    badge.dispose()
    expect(cleared).toEqual([1, 2])
    badge.dispose()
    expect(cleared).toEqual([1, 2])
  })
})
