/**
 * 平台层：托盘图标、tooltip、单击显示窗口、右键菜单（显示窗口 / 退出）。
 * M3 加"等待你"数量角标（setBadge）。
 */
import { Menu, Tray, nativeImage } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'

export interface TrayDeps {
  onShow: () => void
  onQuit: () => void
}

export function createTray(deps: TrayDeps): Tray {
  const tray = new Tray(nativeImage.createFromPath(trayIconPath))
  tray.setToolTip('TagTerm')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示窗口', click: () => deps.onShow() },
      { type: 'separator' },
      { label: '退出', click: () => deps.onQuit() },
    ]),
  )
  tray.on('click', () => deps.onShow())
  return tray
}
