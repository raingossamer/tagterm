/**
 * 平台层：托盘图标、tooltip、单击显示窗口、右键菜单（显示窗口 / 设置 / 退出，模板见 trayMenu.ts）、
 * 角标（setBadge：等你确认 > 0 换 tray-blocked.png 黄点并与 tray-alert.png 红点每 500 ms 交替闪；
 * 否则已完成 > 0 换 tray-done.png 蓝点，否则运行中 > 0 换 tray-working.png 绿点，都为 0 还原，tooltip 带计数；
 * 判定与节拍在 trayMenu.createTrayBadge，这里只传真实 Tray 与图片）。destroy 先停节拍再销毁托盘。
 */
import { Menu, Tray, nativeImage } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'
import trayBlockedIconPath from '../../resources/tray-blocked.png?asset'
import trayAlertIconPath from '../../resources/tray-alert.png?asset'
import trayDoneIconPath from '../../resources/tray-done.png?asset'
import trayWorkingIconPath from '../../resources/tray-working.png?asset'
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
  const images = {
    normal: nativeImage.createFromPath(trayIconPath),
    blocked: nativeImage.createFromPath(trayBlockedIconPath),
    alert: nativeImage.createFromPath(trayAlertIconPath),
    done: nativeImage.createFromPath(trayDoneIconPath),
    working: nativeImage.createFromPath(trayWorkingIconPath),
  }
  const tray = new Tray(images.normal)
  tray.setToolTip('TagTerm')
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(deps)))
  tray.on('click', () => deps.onShow())
  const badge = createTrayBadge(tray, images)
  return {
    ...badge,
    destroy: () => {
      badge.dispose()
      tray.destroy()
    },
  }
}
