/**
 * preload 暴露到 window.tagterm 的 SDK 风格 API（preload 实现、renderer 消费）。
 * 每个操作一个具体函数，渲染进程测试时按函数 mock；所有 on* 返回取消订阅函数。
 */
import type {
  AutoLaunchStatus,
  CreateSessionInput,
  PtyExitEvent,
  PtyOpenResult,
  PtySize,
  SessionPatch,
  SettingsPatch,
  TagListResult,
  TagPatch,
} from './ipc'
import type { Session, Settings, ShellKind, Tag, TagColor, UpdateStatus } from './models'

export type Unsubscribe = () => void

export interface TagTermApi {
  app: {
    getVersion(): Promise<string>
    getOsBuild(): Promise<number>
    listShells(): Promise<ShellKind[]>
    getDataDir(): Promise<string>
    pickImage(): Promise<string | null>
    getAutoLaunch(): Promise<AutoLaunchStatus>
    setAutoLaunch(enabled: boolean): Promise<AutoLaunchStatus>
    onOpenSettings(cb: () => void): Unsubscribe
  }
  session: {
    list(): Promise<Session[]>
    create(input: CreateSessionInput): Promise<Session>
    update(id: string, patch: SessionPatch): Promise<Session>
    remove(id: string): Promise<void>
    pickDirectory(): Promise<string | null>
    onChanged(cb: (sessions: Session[]) => void): Unsubscribe
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    /** 省略 path 读已保存的背景图；传 path 读指定文件（设置弹窗预览未保存的图） */
    readBackgroundImage(path?: string): Promise<string | null>
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
