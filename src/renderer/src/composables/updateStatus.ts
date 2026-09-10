/**
 * 更新状态 → 设置弹窗文案（纯函数）。
 */
import type { UpdateStatus } from '@shared/models'

export function describeUpdateStatus(status: UpdateStatus): string {
  switch (status.state) {
    case 'idle':
      return ''
    case 'checking':
      return '正在检查…'
    case 'none':
      return `已是最新版本 v${status.version ?? ''}`
    case 'available':
      return `发现新版本 v${status.version ?? ''}`
    case 'downloading':
      return `正在下载 v${status.version ?? ''}：${status.percent ?? 0}%`
    case 'downloaded':
      return `v${status.version ?? ''} 已下载，安装后自动重启`
    case 'error':
      return `检查更新失败：${status.message ?? ''}`
  }
}
