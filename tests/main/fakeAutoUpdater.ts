import { EventEmitter } from 'node:events'
import type { AutoUpdaterLike } from '../../src/main/updater/Updater'

/** 假 electron-updater：记录调用顺序，事件由测试手动 emit */
export class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = true
  checkCalls = 0
  downloadCalls = 0
  installCalls = 0
  order: string[] = []
  /** 未打包时 electron-updater 返回 null；缺省模拟已打包（返回结果对象，结论由事件给出） */
  checkResult: unknown = {}
  async checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    return this.checkResult
  }
  async downloadUpdate(): Promise<string[]> {
    this.downloadCalls += 1
    return []
  }
  quitAndInstall(): void {
    this.installCalls += 1
    this.order.push('install')
  }
}
