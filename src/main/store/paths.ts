/**
 * 数据目录解析：%APPDATA%\TagTerm（appData 由装配层传入 app.getPath('appData')，测试可传临时目录）。
 */
import { join } from 'node:path'

export const DATA_DIR_NAME = 'TagTerm'

export function resolveDataDir(appDataDir: string): string {
  return join(appDataDir, DATA_DIR_NAME)
}
