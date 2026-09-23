/**
 * 服务层（深模块）：sessions.json 的加载、CRUD、版本校验与原子写。
 * 目录以构造参数注入（生产传 %APPDATA%\TagTerm，测试传临时目录）；不 import electron。
 */
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import type { CreateSessionInput, SessionPatch } from '@shared/ipc'
import {
  DEFAULT_SHELL,
  SESSIONS_FILE_VERSION,
  type Session,
  type SessionsFile,
} from '@shared/models'
import { readJson, writeJsonAtomic } from './jsonFile'

const SESSIONS_FILE = 'sessions.json'

/** 旧版本写下、现已不用的会话字段（启动命令、最近工具、最近打开时间） */
interface RetiredSessionKeys {
  startupCmd?: unknown
  lastAgent?: unknown
  lastOpenedAt?: unknown
}

export interface SessionStoreDeps {
  /** 每次变更落盘后回调全量列表，由装配层广播 session:changed */
  onChanged?: (sessions: Session[]) => void
}

export class SessionStore {
  private sessions: Session[] = []
  private readonly file: string
  private readonly onChanged: (sessions: Session[]) => void

  constructor(dir: string, deps: SessionStoreDeps = {}) {
    this.file = join(dir, SESSIONS_FILE)
    this.onChanged = deps.onChanged ?? (() => {})
  }

  /** 文件不存在 → 空列表 */
  async load(): Promise<void> {
    const raw = await readJson(this.file)
    if (raw === null) {
      this.sessions = []
      return
    }
    const file = raw as Partial<SessionsFile>
    if (typeof file.version !== 'number' || !Array.isArray(file.sessions)) {
      throw new Error(`数据文件格式不正确：${this.file}`)
    }
    if (file.version > SESSIONS_FILE_VERSION) {
      throw new Error(
        `数据文件版本 ${file.version} 高于本程序支持的版本 ${SESSIONS_FILE_VERSION}，请升级 TagTerm：${this.file}`,
      )
    }
    // 废弃字段读入时丢掉，下一次保存即从文件消失（仍是 v1，不算迁移）；只丢认识的这几个，
    // 其他不认识的键照旧保留 —— 更新的版本写下的可选字段，降级再升级也不能丢
    const sessions = file.sessions as (Session & RetiredSessionKeys)[]
    this.sessions = sessions.map(
      ({ startupCmd: _cmd, lastAgent: _agent, lastOpenedAt: _opened, ...session }) => session,
    )
    console.log(`[store] 已加载 ${this.sessions.length} 个会话：${this.file}`)
  }

  async remove(id: string): Promise<void> {
    const session = this.get(id)
    this.sessions = this.sessions.filter((s) => s !== session)
    await this.save()
  }

  list(): Session[] {
    return [...this.sessions]
  }

  async create(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      name: input.name?.trim() || defaultName(input.cwd),
      cwd: input.cwd,
      shell: input.shell ?? DEFAULT_SHELL,
      sortOrder: this.nextSortOrder(),
      createdAt: new Date().toISOString(),
    }
    this.sessions.push(session)
    await this.save()
    return session
  }

  async update(id: string, patch: SessionPatch): Promise<Session> {
    const session = this.get(id)
    const next: Session = { ...session, ...patch }
    if (patch.name !== undefined) next.name = patch.name.trim() || session.name
    this.sessions[this.sessions.indexOf(session)] = next
    await this.save()
    return next
  }

  /**
   * 按 ids 顺序整体重排 sortOrder 为 1..n；ids 必须是当前全部会话 id 的一个排列，否则拒绝且不改动。
   * 排列校验在此、不在接口层：只有本模块认识「全部会话」。与 TagStore.reorder 同形。
   */
  async reorder(ids: readonly string[]): Promise<void> {
    const current = new Set(this.sessions.map((s) => s.id))
    const given = new Set(ids)
    if (
      ids.length !== this.sessions.length ||
      given.size !== ids.length ||
      ![...given].every((id) => current.has(id))
    ) {
      throw new Error('排序参数必须是全部会话 id 的一个排列')
    }
    const byId = new Map(this.sessions.map((s) => [s.id, s]))
    this.sessions = ids.map((id, i) => ({ ...byId.get(id)!, sortOrder: i + 1 }))
    await this.save()
  }

  /** 找不到即抛错（message 面向用户可读） */
  get(id: string): Session {
    const session = this.sessions.find((s) => s.id === id)
    if (!session) throw new Error(`会话不存在：${id}`)
    return session
  }

  private nextSortOrder(): number {
    return this.sessions.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1
  }

  private async save(): Promise<void> {
    const data: SessionsFile = { version: SESSIONS_FILE_VERSION, sessions: this.sessions }
    await writeJsonAtomic(this.file, data)
    this.onChanged(this.list())
  }
}

/** 名称缺省取目录末段（兼容结尾反斜杠） */
function defaultName(cwd: string): string {
  return basename(cwd.replace(/[\\/]+$/, '')) || cwd
}
