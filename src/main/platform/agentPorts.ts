/**
 * 平台层：AgentSubsystem 两个端口的 Electron 适配器（服务层不 import electron，这里可以）。
 *   electronNotifications：系统通知（Windows 上要先 app.setAppUserModelId 才显示）；点击 → 显示窗口 + 广播 app:select-session 由装配层传 onClick
 *   electronBadge：托盘图标（TrayHandle.setBadge，计数没变它自己不重复设置，黄时自己闪）+ 任务栏按钮 overlay（setOverlayIcon，静态），
 *     两处都按 等你确认（黄点）> 已完成（蓝点）> 运行中（绿点）> 无 的优先级选图
 * tray / window 以 getter 传入：它们在 whenReady 里才创建、before-quit 会置空
 */
import { Notification, type BrowserWindow, type NativeImage } from 'electron'
import type { BadgePort, NotificationPort } from '../agent/AgentSubsystem'
import type { TrayHandle } from '../tray'

export interface ElectronNotificationsDeps {
  /** 烟测模式不弹（避免往通知中心堆 toast） */
  silent: boolean
  /** 用户点了通知：装配层显示窗口并让渲染进程切到该会话 */
  onClick: (sessionId: string) => void
}

export function electronNotifications(deps: ElectronNotificationsDeps): NotificationPort {
  return {
    isSupported: () => !deps.silent && Notification.isSupported(),
    show(sessionId, text) {
      const notification = new Notification({ title: text.title, body: text.body })
      notification.on('click', () => deps.onClick(sessionId))
      notification.show()
    },
  }
}

export interface ElectronBadgeDeps {
  tray: () => TrayHandle | null
  window: () => BrowserWindow | null
  /** 任务栏 overlay 的黄点 / 蓝点 / 绿点图（resources/overlay-blocked.png / overlay-done.png / overlay-working.png，16×16） */
  overlays: { blocked: NativeImage; done: NativeImage; working: NativeImage }
}

/** overlay 静态不闪（每 0.5 s 换 overlay 会让任务栏按钮一直抖，闪烁只在托盘）；优先级与托盘一致 */
export function electronBadge(deps: ElectronBadgeDeps): BadgePort {
  return {
    setCounts(counts) {
      deps.tray()?.setBadge(counts)
      const win = deps.window()
      if (!win || win.isDestroyed()) return
      if (counts.blocked > 0) {
        win.setOverlayIcon(deps.overlays.blocked, `${counts.blocked} 个会话等你确认`)
      } else if (counts.done > 0) {
        win.setOverlayIcon(deps.overlays.done, `${counts.done} 个会话已完成`)
      } else if (counts.working > 0) {
        win.setOverlayIcon(deps.overlays.working, `${counts.working} 个会话运行中`)
      } else {
        win.setOverlayIcon(null, '')
      }
    },
  }
}
