/**
 * 服务层（深模块）：把 electron-updater 的事件流收敛成 UpdateStatus 状态机，向装配层回调广播。
 * electron-updater 以工厂懒加载注入（`loadAutoUpdater`，测试传假对象）：它的 require 要 60 多毫秒，
 * 构造时不加载，首次 check / download / install 才加载一次、关自动下载并挂事件（perf-startup-memory 行为 2）；
 * 加载失败转 error 状态、不抛，下次再用时重新尝试。只提示不自动下载；安装前先回调（装配层 killAll）。
 * 从 import 结果里取 autoUpdater 用 pickAutoUpdater（CommonJS 互操作的坑见它的注释）。
 */
import type { UpdateStatus } from '@shared/models'

/** electron-updater 的 AppUpdater 子集 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  // 各事件的回调参数由注册处自己声明；Node 的 EventEmitter.on 把回调参数定为 any[]，
  // 写 unknown[] 各回调要自己断言类型、写 never[] 又接不住 EventEmitter（假对象与 electron-updater 都是）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 见上
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

/**
 * 从 `import('electron-updater')` 的结果里取出 autoUpdater。electron-updater 是 CommonJS 包，autoUpdater 用 getter 定义
 * （首次读取才按平台 new 一个 NsisUpdater 之类）；Node 原生 import() 一个 CommonJS 包时，只把静态认得出的赋值当命名导出，
 * getter 认不出，所以命名空间上没有 autoUpdater，它只在 default（即 module.exports）上 —— 0.3.10 / 0.3.11 直接取命名导出
 * 拿到 undefined，检查更新必失败。先取 default 上的，取不到再退回命名导出（将来换成 ES 模块也能用）；
 * 取到的不像 AppUpdater 就抛中文错误（经 Updater 转成 error 状态）
 */
export function pickAutoUpdater(mod: unknown): AutoUpdaterLike {
  const ns = (mod ?? {}) as { default?: { autoUpdater?: unknown }; autoUpdater?: unknown }
  const auto = ns.default?.autoUpdater ?? ns.autoUpdater
  if (!isAutoUpdaterLike(auto)) throw new Error('electron-updater 里没有找到可用的 autoUpdater')
  return auto
}

function isAutoUpdaterLike(value: unknown): value is AutoUpdaterLike {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  return typeof o.checkForUpdates === 'function' && typeof o.on === 'function'
}

export interface UpdaterDeps {
  /** 首次用到时才加载 electron-updater（装配层 `import('electron-updater').then(pickAutoUpdater)`，测试返回假对象） */
  loadAutoUpdater: () => Promise<AutoUpdaterLike>
  currentVersion: string
  /** 状态变化回调，由装配层广播 update:status */
  onStatus: (status: UpdateStatus) => void
  /** quitAndInstall 之前执行（结束全部终端） */
  beforeInstall: () => void
}

export class Updater {
  private current: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null
  /** 加载中 / 已加载的 electron-updater；加载失败时清空，下次再试 */
  private loading: Promise<AutoUpdaterLike> | null = null

  constructor(private readonly deps: UpdaterDeps) {}

  status(): UpdateStatus {
    return { ...this.current }
  }

  /** 检查一次；失败转成 error 状态，不向上抛。未打包时 electron-updater 直接返回 null 且不发事件 */
  async check(): Promise<void> {
    const auto = await this.load()
    if (!auto) return
    this.set({ state: 'checking' })
    try {
      const result = await auto.checkForUpdates()
      if (result === null && this.current.state === 'checking') {
        this.set({ state: 'error', message: '未打包的开发版本不支持检查更新' })
      }
    } catch (err) {
      this.setError(err)
    }
  }

  async download(): Promise<void> {
    const auto = await this.load()
    if (!auto) return
    try {
      await auto.downloadUpdate()
    } catch (err) {
      this.setError(err)
    }
  }

  /** 先加载（失败就只报状态、不结束终端），再回调结束终端、退出安装 */
  async install(): Promise<void> {
    const auto = await this.load()
    if (!auto) return
    this.deps.beforeInstall()
    auto.quitAndInstall()
  }

  /** 启动后延迟自动检查一次（只提示不下载；到点才加载模块） */
  scheduleAutoCheck(delayMs: number): void {
    this.cancelAutoCheck()
    this.timer = setTimeout(() => void this.check(), delayMs)
  }

  cancelAutoCheck(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** 加载一次 electron-updater 并接线；失败转 error 状态并返回 null（本次调用到此为止） */
  private async load(): Promise<AutoUpdaterLike | null> {
    if (!this.loading) {
      this.loading = this.deps.loadAutoUpdater().then((auto) => {
        this.attach(auto)
        return auto
      })
    }
    try {
      return await this.loading
    } catch (err) {
      this.loading = null
      this.setError(err)
      return null
    }
  }

  private attach(auto: AutoUpdaterLike): void {
    auto.autoDownload = false
    auto.on('update-available', (info: { version: string }) =>
      this.set({ state: 'available', version: info.version }),
    )
    auto.on('update-not-available', (info: { version?: string }) =>
      this.set({ state: 'none', version: info?.version ?? this.deps.currentVersion }),
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
