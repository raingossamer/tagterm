/**
 * 托盘菜单模板（纯函数，不 import electron）：显示窗口 / 设置 / 退出。
 * 与 electron 的 MenuItemConstructorOptions 结构兼容，由 tray.ts 交给 Menu.buildFromTemplate。
 * 另有角标：按 等你确认（黄点）> 运行中（绿点）> 原图标 的优先级换图标 + 计数 tooltip；Tray 以最小接口注入，tray.ts 传真实 Tray 与 nativeImage。
 */
import type { BadgeCounts } from './agent/AgentSubsystem'

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

/** 等你确认优先于运行中；都为 0 只剩应用名 */
export function trayTooltip(counts: BadgeCounts): string {
  if (counts.blocked > 0) return `TagTerm · ${counts.blocked} 个会话等你确认`
  if (counts.working > 0) return `TagTerm · ${counts.working} 个会话运行中`
  return 'TagTerm'
}

/** Tray 的最小接口（electron.Tray 结构子集） */
export interface TrayLike<Image> {
  setImage(image: Image): void
  setToolTip(text: string): void
}

export interface TrayBadge {
  /** 等你确认 > 0 换黄点图标；否则运行中 > 0 换绿点图标；都为 0 还原；tooltip 同一优先级；两个计数都没变不重复设置 */
  setBadge(counts: BadgeCounts): void
  counts(): BadgeCounts
}

export function createTrayBadge<Image>(
  tray: TrayLike<Image>,
  images: { normal: Image; blocked: Image; working: Image },
): TrayBadge {
  let current: BadgeCounts = { blocked: 0, working: 0 }
  return {
    setBadge(counts) {
      if (counts.blocked === current.blocked && counts.working === current.working) return
      current = { ...counts }
      tray.setImage(
        counts.blocked > 0 ? images.blocked : counts.working > 0 ? images.working : images.normal,
      )
      tray.setToolTip(trayTooltip(counts))
    },
    counts: () => ({ ...current }),
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
