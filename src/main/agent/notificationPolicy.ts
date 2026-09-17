/**
 * 纯函数：某会话状态变化要不要弹系统通知、弹什么。
 * 进入 blocked 且不是正被查看 → 「<会话名> 等你确认」（正文 = 那一行提示）；进入 done → 「<会话名> 完成」（done 定义上就是没人看）；
 * 同一状态重复变化不重复弹（prev 相同即跳过），离开后再进入再弹。Electron Notification 的调用留在装配层。
 */
import type { AgentStatus, SessionRuntime } from '@shared/models'

export interface NotificationText {
  title: string
  body: string
}

export function decideNotification(
  prevStatus: AgentStatus | null,
  next: SessionRuntime,
  isViewed: boolean,
  sessionName: string,
): NotificationText | null {
  if (prevStatus === next.status) return null
  if (next.status === 'blocked') {
    return isViewed ? null : { title: `${sessionName} 等你确认`, body: next.pendingHint ?? '' }
  }
  if (next.status === 'done') return { title: `${sessionName} 完成`, body: '' }
  return null
}
