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
    this.sessions = file.sessions
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

  /** 找不到即抛错（message 面向用户可读） */
  get(id: string): Session {
    const session = this.sessions.find((s) => s.id === id)
    if (!session) throw new Error(`会话不存在：${id}`)
    return session
  }

  /** 每次打开终端时写 lastOpenedAt */
  async touchOpened(id: string): Promise<void> {
    const session = this.get(id)
    this.sessions[this.sessions.indexOf(session)] = {
      ...session,
      lastOpenedAt: new Date().toISOString(),
    }
    await this.save()
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
