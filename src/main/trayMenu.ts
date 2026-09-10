/**
 * 托盘菜单模板（纯函数，不 import electron）：显示窗口 / 设置 / 退出。
 * 与 electron 的 MenuItemConstructorOptions 结构兼容，由 tray.ts 交给 Menu.buildFromTemplate。
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

export function buildTrayMenuTemplate(deps: TrayMenuDeps): TrayMenuItem[] {
  return [
    { label: '显示窗口', click: () => deps.onShow() },
    { type: 'separator' },
    { label: '设置', click: () => deps.onOpenSettings() },
    { type: 'separator' },
    { label: '退出', click: () => deps.onQuit() },
  ]
}
