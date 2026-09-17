/**
 * 平台层：托盘图标、tooltip、单击显示窗口、右键菜单（显示窗口 / 设置 / 退出，模板见 trayMenu.ts）、
 * 「等你确认」角标（setBadge：> 0 换 tray-blocked.png + 计数 tooltip，0 还原；判定在 trayMenu.createTrayBadge）。
 */
import { Menu, Tray, nativeImage } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'
import trayBlockedIconPath from '../../resources/tray-blocked.png?asset'
import {
  buildTrayMenuTemplate,
  createTrayBadge,
  type TrayBadge,
  type TrayMenuDeps,
} from './trayMenu'

export type TrayDeps = TrayMenuDeps

export interface TrayHandle extends TrayBadge {
  destroy(): void
}

export function createTray(deps: TrayDeps): TrayHandle {
  const normal = nativeImage.createFromPath(trayIconPath)
  const blocked = nativeImage.createFromPath(trayBlockedIconPath)
  const tray = new Tray(normal)
  tray.setToolTip('TagTerm')
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(deps)))
  tray.on('click', () => deps.onShow())
  const badge = createTrayBadge(tray, { normal, blocked })
  return { ...badge, destroy: () => tray.destroy() }
}
