/**
 * 平台层：会话子系统 FolderPort 的 Electron 适配器（shell.openPath）——在资源管理器打开目录本身。
 * shell.openPath 成功返回空串、失败返回错误说明；端口的语义是「打开了为 null，打不开返回原因」。
 * 「打开日志目录」共用这一个适配器。
 */
import { shell } from 'electron'
import type { FolderPort } from '../session/SessionSubsystem'

export function electronFolders(): FolderPort {
  return {
    async open(path) {
      return (await shell.openPath(path)) || null
    },
  }
}
