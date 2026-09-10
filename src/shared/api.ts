/**
 * preload 暴露到 window.tagterm 的 SDK 风格 API（preload 实现、renderer 消费）。
 * 每个操作一个具体函数，渲染进程测试时按函数 mock；所有 on* 返回取消订阅函数。
 */
import type { CreateSessionInput, SessionPatch } from './ipc'
import type { Session, ShellKind } from './models'

export type Unsubscribe = () => void

export interface TagTermApi {
  app: {
    getVersion(): Promise<string>
    listShells(): Promise<ShellKind[]>
  }
  session: {
    list(): Promise<Session[]>
    create(input: CreateSessionInput): Promise<Session>
    update(id: string, patch: SessionPatch): Promise<Session>
    remove(id: string): Promise<void>
    pickDirectory(): Promise<string | null>
    onChanged(cb: (sessions: Session[]) => void): Unsubscribe
  }
}
