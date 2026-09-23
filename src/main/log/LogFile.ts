/**
 * 服务层：日志落文件（reliability-hardening 决策 4）。打包版没有控制台，出了问题只能靠这份文件排查。
 * 每行「本地时间 级别 内容」；写满 maxBytes 就轮转（main.log → main.1.log → main.2.log …，只保留 keep 份）；
 * 日志目录不存在自动建；open 之前（数据目录还没解析出来）写的先缓冲，open 时按顺序补写；写失败只丢这一行、不抛。
 * 同步写：量很小（事件与错误），而且退出前最后几行也要落得进去。只收事件与错误 —— 终端输出与键入内容一律不记（规范「日志」）。
 * 不 import electron，路径由装配层给。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LogFileOptions {
  /** 单个文件的上限（字节），写满就轮转 */
  maxBytes: number
  /** 连同 main.log 一共保留几份 */
  keep: number
  /** open 之前最多缓冲几行，多了丢最旧的；缺省 1000 */
  maxBuffered?: number
  now?: () => Date
}

const BASE_NAME = 'main'

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 本地时间 YYYY-MM-DD HH:mm:ss.SSS：用户看日志时对得上自己的时钟 */
function stamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  )
}

export class LogFile {
  private logsDir: string | null = null
  private size = 0
  private readonly buffered: string[] = []
  private readonly now: () => Date
  private readonly maxBuffered: number

  constructor(private readonly opts: LogFileOptions) {
    this.now = opts.now ?? (() => new Date())
    this.maxBuffered = opts.maxBuffered ?? 1000
  }

  /** 已打开的日志目录；还没 open 或 open 失败为 null */
  get dir(): string | null {
    return this.logsDir
  }

  /** 指定日志目录并补写缓冲；目录建不出来就一直只缓冲（丢最旧的），不抛 */
  open(dir: string): void {
    try {
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${BASE_NAME}.log`)
      this.size = existsSync(file) ? statSync(file).size : 0
      this.logsDir = dir
    } catch {
      return
    }
    for (const line of this.buffered.splice(0)) this.append(line)
  }

  write(level: LogLevel, message: string): void {
    const line = `${stamp(this.now())} ${level.padEnd(5)} ${message}\r\n`
    if (this.logsDir === null) {
      this.buffered.push(line)
      if (this.buffered.length > this.maxBuffered) this.buffered.shift()
      return
    }
    this.append(line)
  }

  private fileOf(index: number): string {
    return join(this.logsDir!, index === 0 ? `${BASE_NAME}.log` : `${BASE_NAME}.${index}.log`)
  }

  private append(line: string): void {
    const bytes = Buffer.byteLength(line)
    try {
      if (this.size > 0 && this.size + bytes > this.opts.maxBytes) this.rotate()
      appendFileSync(this.fileOf(0), line)
      this.size += bytes
    } catch {
      // 写不进去（磁盘满、被占用）只丢这一行，不能因为日志影响功能
    }
  }

  /** main.{keep-1} 删掉，其余依次后移一位，main.log 变 main.1.log */
  private rotate(): void {
    rmSync(this.fileOf(this.opts.keep - 1), { force: true })
    for (let i = this.opts.keep - 2; i >= 0; i -= 1) {
      if (existsSync(this.fileOf(i))) renameSync(this.fileOf(i), this.fileOf(i + 1))
    }
    this.size = 0
  }
}
