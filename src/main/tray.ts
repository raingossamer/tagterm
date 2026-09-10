/**
 * 平台层：托盘图标、tooltip、单击显示窗口、右键菜单（显示窗口 / 设置 / 退出，模板见 trayMenu.ts）。
 * M3 加"等待你"数量角标（setBadge）。
 */
import { Menu, Tray, nativeImage } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'
import { buildTrayMenuTemplate, type TrayMenuDeps } from './trayMenu'

export type TrayDeps = TrayMenuDeps

export function createTray(deps: TrayDeps): Tray {
  const tray = new Tray(nativeImage.createFromPath(trayIconPath))
  tray.setToolTip('TagTerm')
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(deps)))
  tray.on('click', () => deps.onShow())
  return tray
}
