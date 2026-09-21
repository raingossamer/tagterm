/**
 * 托盘菜单模板（纯函数，不 import electron）：显示窗口 / 设置 / 退出。
 * 与 electron 的 MenuItemConstructorOptions 结构兼容，由 tray.ts 交给 Menu.buildFromTemplate。
 * 另有角标：按 等你确认（黄）> 已完成（蓝）> 运行中（绿）> 原图标 的优先级换图标 + 计数 tooltip；
 * 有人等你确认时图标黄 ↔ 红每 500 ms 交替（提醒人去处理），归 0 即停。
 * Tray 与定时器都以最小接口注入：tray.ts 传真实 Tray / nativeImage / setInterval，测试传假件断言换图序列。
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

/** 等你确认 > 已完成 > 运行中；都为 0 只剩应用名。蓝优先于绿：提醒人去给跑完的终端发下一轮任务 */
export function trayTooltip(counts: BadgeCounts): string {
  if (counts.blocked > 0) return `TagTerm · ${counts.blocked} 个会话等你确认`
  if (counts.done > 0) return `TagTerm · ${counts.done} 个会话已完成`
  if (counts.working > 0) return `TagTerm · ${counts.working} 个会话运行中`
  return 'TagTerm'
}

/** Tray 的最小接口（electron.Tray 结构子集） */
export interface TrayLike<Image> {
  setImage(image: Image): void
  setToolTip(text: string): void
}

/** 角标图：normal 原图标、blocked 黄点、alert 红点（与黄点交替闪）、done 蓝点、working 绿点 */
export interface TrayBadgeImages<Image> {
  normal: Image
  blocked: Image
  alert: Image
  done: Image
  working: Image
}

/** 闪烁节拍的定时器（测试注入手动触发的假定时器） */
export interface TrayBadgeTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

/** 黄 ↔ 红交替的间隔 */
export const BLINK_INTERVAL_MS = 500

export interface TrayBadge {
  /**
   * 等你确认 > 0 → 黄点图并起闪烁节拍（已在闪则不重启、不碰图，只换 tooltip）；
   * 否则停节拍并按 已完成（蓝）> 运行中（绿）> 原图标 落图；tooltip 同一优先级；三个计数都没变不重复设置
   */
  setBadge(counts: BadgeCounts): void
  counts(): BadgeCounts
  /** 停掉闪烁定时器（托盘销毁 / 退出时必调，否则挂着的 interval 会让进程退不掉）；可重复调用 */
  dispose(): void
}

const realTimers: TrayBadgeTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

export function createTrayBadge<Image>(
  tray: TrayLike<Image>,
  images: TrayBadgeImages<Image>,
  timers: TrayBadgeTimers = realTimers,
): TrayBadge {
  let current: BadgeCounts = { blocked: 0, working: 0, done: 0 }
  let blink: unknown = null
  let isAlertFrame = false

  const stopBlink = (): void => {
    if (blink === null) return
    timers.clearInterval(blink)
    blink = null
    isAlertFrame = false
  }
  const steadyImage = (counts: BadgeCounts): Image =>
    counts.done > 0 ? images.done : counts.working > 0 ? images.working : images.normal

  return {
    setBadge(counts) {
      if (
        counts.blocked === current.blocked &&
        counts.working === current.working &&
        counts.done === current.done
      ) {
        return
      }
      current = { ...counts }
      if (counts.blocked > 0) {
        if (blink === null) {
          tray.setImage(images.blocked)
          blink = timers.setInterval(() => {
            isAlertFrame = !isAlertFrame
            tray.setImage(isAlertFrame ? images.alert : images.blocked)
          }, BLINK_INTERVAL_MS)
        }
      } else {
        stopBlink()
        tray.setImage(steadyImage(counts))
      }
      tray.setToolTip(trayTooltip(counts))
    },
    counts: () => ({ ...current }),
    dispose: stopBlink,
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
