/**
 * 服务层（深模块）：把 electron-updater 的事件流收敛成 UpdateStatus 状态机，向装配层回调广播。
 * autoUpdater 以接口注入（测试传假对象）；只提示不自动下载；安装前先回调（装配层 killAll）。
 */
import type { UpdateStatus } from '@shared/models'

/** electron-updater 的 AppUpdater 子集 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdaterDeps {
  autoUpdater: AutoUpdaterLike
  currentVersion: string
  /** 状态变化回调，由装配层广播 update:status */
  onStatus: (status: UpdateStatus) => void
  /** quitAndInstall 之前执行（结束全部终端） */
  beforeInstall: () => void
}

export class Updater {
  private current: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: UpdaterDeps) {
    const auto = deps.autoUpdater
    auto.autoDownload = false
    auto.on('update-available', (info: { version: string }) =>
      this.set({ state: 'available', version: info.version }),
    )
    auto.on('update-not-available', (info: { version?: string }) =>
      this.set({ state: 'none', version: info?.version ?? deps.currentVersion }),
    )
    auto.on('download-progress', (p: { percent: number }) =>
      this.set({
        state: 'downloading',
        version: this.current.version,
        percent: Math.round(p.percent),
      }),
    )
    auto.on('update-downloaded', (info: { version: string }) =>
      this.set({ state: 'downloaded', version: info.version }),
    )
    auto.on('error', (err: unknown) => this.setError(err))
  }

  status(): UpdateStatus {
    return { ...this.current }
  }

  /** 检查一次；失败转成 error 状态，不向上抛。未打包时 electron-updater 直接返回 null 且不发事件 */
  async check(): Promise<void> {
    this.set({ state: 'checking' })
    try {
      const result = await this.deps.autoUpdater.checkForUpdates()
      if (result === null && this.current.state === 'checking') {
        this.set({ state: 'error', message: '未打包的开发版本不支持检查更新' })
      }
    } catch (err) {
      this.setError(err)
    }
  }

  async download(): Promise<void> {
    try {
      await this.deps.autoUpdater.downloadUpdate()
    } catch (err) {
      this.setError(err)
    }
  }

  install(): void {
    this.deps.beforeInstall()
    this.deps.autoUpdater.quitAndInstall()
  }

  /** 启动后延迟自动检查一次（只提示不下载） */
  scheduleAutoCheck(delayMs: number): void {
    this.cancelAutoCheck()
    this.timer = setTimeout(() => void this.check(), delayMs)
  }

  cancelAutoCheck(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private set(status: UpdateStatus): void {
    this.current = status
    this.deps.onStatus(this.status())
  }

  private setError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[updater] ${message}`)
    this.set({ state: 'error', message })
  }
}
