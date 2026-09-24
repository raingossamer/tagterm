/**
 * 平台层：配置导入导出的文件对话框（ConfigDialogPort 的 Electron 适配器）。
 * 烟测不弹对话框（无人值守）：用 fixedConfigDialogs 给定烟测数据目录下的固定路径，导出 / 导入都落在那里，烟测脚本自己读写核对。
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ConfigDialogPort } from '../config/ConfigService'

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }]

export function electronConfigDialogs(getWindow: () => BrowserWindow | null): ConfigDialogPort {
  return {
    async pickSavePath(defaultName) {
      const options = {
        title: '导出配置',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: JSON_FILTER,
      }
      const win = getWindow()
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      return result.canceled || !result.filePath ? null : result.filePath
    },
    async pickOpenPath() {
      const options = {
        title: '导入配置',
        properties: ['openFile' as const],
        filters: JSON_FILTER,
      }
      const win = getWindow()
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  }
}

/** 烟测用：不弹框，导出与导入各用一个固定路径 */
export function fixedConfigDialogs(paths: { save: string; open: string }): ConfigDialogPort {
  return {
    pickSavePath: async () => paths.save,
    pickOpenPath: async () => paths.open,
  }
}
