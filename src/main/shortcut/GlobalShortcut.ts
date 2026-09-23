/**
 * 服务层：全局快捷键（唤出 / 隐藏窗口）。系统热键以命名端口 ShortcutPort 注入（生产适配器在 platform/shortcutPort.ts），
 * 本文件不 import electron。只管「注册了哪个键位、按下调谁」：
 * - start：按配置注册，被别的程序占着不抛、记一行日志，状态 registered 为假（设置里显示红字）
 * - apply：换键位时先注册新的、成功才注销旧的；新的被占用返回 false，旧的照旧可用、配置不变
 * - pause / resume：设置里录新键位期间暂停当前热键，免得按到旧键把窗口藏掉
 */
import type { GlobalShortcutConfig } from '@shared/models'
import type { GlobalShortcutStatus } from '@shared/ipc'

/** 系统热键的最小端口：register 被占用（或已注册）时返回 false */
export interface ShortcutPort {
  register(accelerator: string, onPress: () => void): boolean
  unregister(accelerator: string): void
}

export interface GlobalShortcutDeps {
  port: ShortcutPort
  /** 热键按下：装配层据窗口状态唤出或藏起主窗口 */
  onPress: () => void
}

export class GlobalShortcut {
  private config: GlobalShortcutConfig = { enabled: false, accelerator: '' }
  /** 当前真正注册在系统里的键位 */
  private registered: string | null = null
  /** 暂停时先注销的键位，resume 时注册回来 */
  private paused: string | null = null
  private isPaused = false

  constructor(private readonly deps: GlobalShortcutDeps) {}

  /** 启动时按配置注册；失败只记日志 */
  start(config: GlobalShortcutConfig): void {
    this.config = { ...config }
    if (!config.enabled) return
    if (this.tryRegister(config.accelerator)) this.registered = config.accelerator
    else console.warn(`[shortcut] 全局快捷键 ${config.accelerator} 注册失败，可能已被其他程序占用`)
  }

  /** 换成新配置；新键位注册不上返回 false（旧的保留、配置不变）。暂停中先恢复再换 */
  apply(next: GlobalShortcutConfig): boolean {
    if (this.isPaused) this.resume()
    if (!next.enabled) {
      this.release()
      this.config = { ...next }
      return true
    }
    if (this.registered !== next.accelerator) {
      if (!this.tryRegister(next.accelerator)) return false
      this.release()
      this.registered = next.accelerator
    }
    this.config = { ...next }
    return true
  }

  /** 暂停当前热键（只在内存）：注销但记住，resume 时注册回来 */
  pause(): void {
    if (this.isPaused) return
    this.isPaused = true
    this.paused = this.registered
    this.release()
  }

  resume(): void {
    if (!this.isPaused) return
    this.isPaused = false
    const accelerator = this.paused
    this.paused = null
    if (accelerator === null) return
    if (this.tryRegister(accelerator)) this.registered = accelerator
    else console.warn(`[shortcut] 全局快捷键 ${accelerator} 恢复注册失败，可能已被其他程序占用`)
  }

  /** 暂停中按暂停前的注册情况报告：录键位期间设置里不该冒出「被占用」红字 */
  status(): GlobalShortcutStatus {
    const isRegistered = this.isPaused ? this.paused !== null : this.registered !== null
    return { ...this.config, registered: isRegistered }
  }

  /** 退出时注销 */
  dispose(): void {
    this.release()
    this.isPaused = false
    this.paused = null
  }

  private tryRegister(accelerator: string): boolean {
    return this.deps.port.register(accelerator, () => this.deps.onPress())
  }

  private release(): void {
    if (this.registered === null) return
    this.deps.port.unregister(this.registered)
    this.registered = null
  }
}
