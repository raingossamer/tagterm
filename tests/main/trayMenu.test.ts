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

  it('trayTooltip：0 为「TagTerm」，N 为「TagTerm · N 个会话等你确认」', () => {
    expect(trayTooltip(0)).toBe('TagTerm')
    expect(trayTooltip(2)).toBe('TagTerm · 2 个会话等你确认')
  })

  it('setBadge(N) 换成带黄点的图标与计数 tooltip；setBadge(0) 还原；相同计数不重复设置', () => {
    const calls: string[] = []
    const tray = {
      setImage: (img: string) => calls.push(`image:${img}`),
      setToolTip: (text: string) => calls.push(`tip:${text}`),
    }
    const badge = createTrayBadge(tray, { normal: 'normal.png', blocked: 'blocked.png' })

    badge.setBadge(2)
    expect(calls).toEqual(['image:blocked.png', 'tip:TagTerm · 2 个会话等你确认'])
    badge.setBadge(2)
    expect(calls).toHaveLength(2)
    badge.setBadge(3)
    expect(calls.slice(2)).toEqual(['image:blocked.png', 'tip:TagTerm · 3 个会话等你确认'])
    badge.setBadge(0)
    expect(calls.slice(4)).toEqual(['image:normal.png', 'tip:TagTerm'])
    expect(badge.count()).toBe(0)
  })
})
