import { describe, expect, it, vi } from 'vitest'
import { buildTrayMenuTemplate } from '../../src/main/trayMenu'

describe('buildTrayMenuTemplate', () => {
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
})
