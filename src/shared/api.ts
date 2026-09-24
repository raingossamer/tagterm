/**
 * preload 暴露到 window.tagterm 的 SDK 风格 API（preload 实现、renderer 消费）。
 * 每个操作一个具体函数，渲染进程测试时按函数 mock；所有 on* 返回取消订阅函数。
 */
import type {
  AutoLaunchStatus,
  BackgroundImageData,
  CreateSessionInput,
  GlobalShortcutStatus,
  HookAgent,
  HooksStatus,
  HooksStatusMap,
  OutputReport,
  PtyExitEvent,
  PtyOpenResult,
  PtySize,
  SessionPatch,
  SettingsPatch,
  TagListResult,
  TagPatch,
  ConfigExportResult,
  ConfigPrefs,
} from './ipc'
import type {
  GlobalShortcutConfig,
  Session,
  SessionRuntime,
  Settings,
  ShellKind,
  Tag,
  TagColor,
  UpdateStatus,
} from './models'

export type Unsubscribe = () => void

export interface TagTermApi {
  app: {
    getVersion(): Promise<string>
    getOsBuild(): Promise<number>
    listShells(): Promise<ShellKind[]>
    getDataDir(): Promise<string>
    /** 在资源管理器打开日志目录（路径由主进程定）；打不开 reject 中文 message */
    openLogsDir(): Promise<void>
    pickImage(): Promise<string | null>
    getAutoLaunch(): Promise<AutoLaunchStatus>
    setAutoLaunch(enabled: boolean): Promise<AutoLaunchStatus>
    /** 全局快捷键（唤出 / 隐藏窗口）的配置与这次启动有没有注册上 */
    getGlobalShortcut(): Promise<GlobalShortcutStatus>
    /** 改全局快捷键：先注册新的，被占用 reject「该快捷键已被其他程序占用」（旧的保留）；成功才落盘 */
    setGlobalShortcut(config: GlobalShortcutConfig): Promise<GlobalShortcutStatus>
    /** 设置里录新键位期间暂停当前热键（true）/ 恢复（false） */
    pauseGlobalShortcut(paused: boolean): Promise<void>
    /** 导出配置（用户偏好）：主进程弹保存对话框，取消为 null；渲染进程只交出终端字号 */
    exportConfig(prefs: ConfigPrefs): Promise<ConfigExportResult | null>
    /** 全局快捷键唤出窗口后：把焦点交给当前终端 */
    onFocusTerminal(cb: () => void): Unsubscribe
    onOpenSettings(cb: () => void): Unsubscribe
    /** 系统通知被点击 → 切到该会话 */
    onSelectSession(cb: (sessionId: string) => void): Unsubscribe
  }
  session: {
    list(): Promise<Session[]>
    create(input: CreateSessionInput): Promise<Session>
    update(id: string, patch: SessionPatch): Promise<Session>
    remove(id: string): Promise<void>
    /** 按 ids 顺序整体重排；ids 必须是全部会话 id 的一个排列 */
    reorder(ids: string[]): Promise<void>
    pickDirectory(): Promise<string | null>
    /** 在资源管理器打开该会话的当前目录（终端里 cd 过则是 cd 后的目录）；打不开 reject 中文 message */
    openDirectory(id: string): Promise<void>
    onChanged(cb: (sessions: Session[]) => void): Unsubscribe
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    /** 省略 path 读已保存的背景图；传 path 读指定文件（设置弹窗预览未保存的图）。给的是 MIME + 字节，渲染进程自己建 Blob URL */
    readBackgroundImage(path?: string): Promise<BackgroundImageData | null>
    onChanged(cb: (settings: Settings) => void): Unsubscribe
  }
  update: {
    getStatus(): Promise<UpdateStatus>
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (status: UpdateStatus) => void): Unsubscribe
  }
  tag: {
    list(): Promise<TagListResult>
    create(name: string, color?: TagColor): Promise<Tag>
    update(id: string, patch: TagPatch): Promise<Tag>
    reorder(ids: string[]): Promise<void>
    remove(id: string): Promise<void>
    attach(sessionId: string, tagId: string): Promise<void>
    detach(sessionId: string, tagId: string): Promise<void>
    onChanged(cb: (result: TagListResult) => void): Unsubscribe
  }
  agent: {
    list(): Promise<SessionRuntime[]>
    /** 正被查看的会话（不可见或失焦发 null） */
    setViewed(sessionId: string | null): Promise<void>
    /** 某会话静默 1.5 s 后屏幕末尾的几行（单向，不等待） */
    reportOutput(sessionId: string, report: OutputReport): void
    getHooksStatus(): Promise<HooksStatusMap>
    /** 打开 = 备份并追加我们的 hooks 条目，关闭 = 只删我们的；返回该目标的实际状态 */
    setHooks(agent: HookAgent, enabled: boolean): Promise<HooksStatus>
    onStatus(cb: (runtime: SessionRuntime) => void): Unsubscribe
  }
  pty: {
    open(sessionId: string, size: PtySize): Promise<PtyOpenResult>
    write(sessionId: string, data: string): void
    resize(sessionId: string, size: PtySize): Promise<void>
    kill(sessionId: string): Promise<void>
    isAlive(sessionId: string): Promise<boolean>
    onData(cb: (sessionId: string, data: string) => void): Unsubscribe
    onExit(cb: (e: PtyExitEvent) => void): Unsubscribe
  }
}
