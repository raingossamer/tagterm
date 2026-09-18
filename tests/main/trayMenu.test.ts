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

  it('trayTooltip：都为 0 是「TagTerm」；等你确认优先「TagTerm · N 个会话等你确认」；只有运行中「TagTerm · N 个会话运行中」', () => {
    expect(trayTooltip({ blocked: 0, working: 0 })).toBe('TagTerm')
    expect(trayTooltip({ blocked: 2, working: 1 })).toBe('TagTerm · 2 个会话等你确认')
    expect(trayTooltip({ blocked: 0, working: 3 })).toBe('TagTerm · 3 个会话运行中')
  })

  it('setBadge：等你确认 > 0 换黄点图标；否则运行中 > 0 换绿点图标；都为 0 还原；tooltip 同一优先级；两个计数都没变不重复设置', () => {
    const calls: string[] = []
    const tray = {
      setImage: (img: string) => calls.push(`image:${img}`),
      setToolTip: (text: string) => calls.push(`tip:${text}`),
    }
    const badge = createTrayBadge(tray, {
      normal: 'normal.png',
      blocked: 'blocked.png',
      working: 'working.png',
    })

    badge.setBadge({ blocked: 0, working: 3 })
    expect(calls).toEqual(['image:working.png', 'tip:TagTerm · 3 个会话运行中'])
    badge.setBadge({ blocked: 0, working: 3 })
    expect(calls).toHaveLength(2)
    badge.setBadge({ blocked: 2, working: 3 })
    expect(calls.slice(2)).toEqual(['image:blocked.png', 'tip:TagTerm · 2 个会话等你确认'])
    badge.setBadge({ blocked: 2, working: 0 })
    expect(calls.slice(4)).toEqual(['image:blocked.png', 'tip:TagTerm · 2 个会话等你确认'])
    badge.setBadge({ blocked: 0, working: 0 })
    expect(calls.slice(6)).toEqual(['image:normal.png', 'tip:TagTerm'])
    expect(badge.counts()).toEqual({ blocked: 0, working: 0 })
  })
})
