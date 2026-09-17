/**
 * 托盘菜单模板（纯函数，不 import electron）：显示窗口 / 设置 / 退出。
 * 与 electron 的 MenuItemConstructorOptions 结构兼容，由 tray.ts 交给 Menu.buildFromTemplate。
 * 另有「等你确认」角标：N > 0 换带黄点的图标 + 计数 tooltip，0 还原；Tray 以最小接口注入，tray.ts 传真实 Tray 与 nativeImage。
 */
export interface TrayMenuDeps {
  onShow: () => void
  onOpenSettings: () => void
  onQuit: () => void
}

export interface TrayMenuItem {
  label?: string
  type?: 'separator'
  click?: () => void
}

export function trayTooltip(blockedCount: number): string {
  return blockedCount > 0 ? `TagTerm · ${blockedCount} 个会话等你确认` : 'TagTerm'
}

/** Tray 的最小接口（electron.Tray 结构子集） */
export interface TrayLike<Image> {
  setImage(image: Image): void
  setToolTip(text: string): void
}

export interface TrayBadge {
  /** 等你确认的会话数：> 0 换带黄点的图标与计数 tooltip，0 还原；计数没变不重复设置 */
  setBadge(blockedCount: number): void
  count(): number
}

export function createTrayBadge<Image>(
  tray: TrayLike<Image>,
  images: { normal: Image; blocked: Image },
): TrayBadge {
  let current = 0
  return {
    setBadge(blockedCount) {
      if (blockedCount === current) return
      current = blockedCount
      tray.setImage(blockedCount > 0 ? images.blocked : images.normal)
      tray.setToolTip(trayTooltip(blockedCount))
    },
    count: () => current,
  }
}

export function buildTrayMenuTemplate(deps: TrayMenuDeps): TrayMenuItem[] {
  return [
    { label: '显示窗口', click: () => deps.onShow() },
    { type: 'separator' },
    { label: '设置', click: () => deps.onOpenSettings() },
    { type: 'separator' },
    { label: '退出', click: () => deps.onQuit() },
  ]
}
