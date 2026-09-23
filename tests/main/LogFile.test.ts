import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogFile } from '../../src/main/log/LogFile'

/** 固定本地时间 2026-09-23 18:20:31.045 */
const fixedNow = (): Date => new Date(2026, 8, 23, 18, 20, 31, 45)

describe('LogFile（日志落文件，真实临时目录）', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-log-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const lines = (file: string): string[] =>
    readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)

  it('每行「本地时间 级别 内容」；open 之前写的先缓冲，open 时按顺序补写；日志目录不存在自动建', () => {
    const log = new LogFile({ maxBytes: 1024 * 1024, keep: 3, now: fixedNow })
    log.write('INFO', '[main] 可用 shell：cmd.exe')
    log.write('WARN', '[agent] 同步失败')
    const logsDir = join(dir, 'logs')
    log.open(logsDir)
    log.write('ERROR', '[renderer] 打开终端失败')

    expect(lines(join(logsDir, 'main.log'))).toEqual([
      '2026-09-23 18:20:31.045 INFO  [main] 可用 shell：cmd.exe',
      '2026-09-23 18:20:31.045 WARN  [agent] 同步失败',
      '2026-09-23 18:20:31.045 ERROR [renderer] 打开终端失败',
    ])
    expect(log.dir).toBe(logsDir)
  })

  it('写满上限就轮转：main.log → main.1.log → main.2.log，只保留 3 份，最新的在 main.log', () => {
    const log = new LogFile({ maxBytes: 200, keep: 3, now: fixedNow })
    log.open(dir)
    for (let i = 0; i < 40; i += 1) log.write('INFO', `第 ${String(i).padStart(2, '0')} 行`)

    expect(readdirSync(dir).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log'])
    for (const f of ['main.log', 'main.1.log', 'main.2.log']) {
      expect(readFileSync(join(dir, f)).length).toBeLessThanOrEqual(200)
    }
    expect(lines(join(dir, 'main.log')).at(-1)).toMatch(/第 39 行$/)
    // 较旧的在 .1、更旧的在 .2
    const firstOf = (f: string): number => Number(/第 (\d+) 行/.exec(lines(join(dir, f))[0]!)![1])
    expect(firstOf('main.2.log')).toBeLessThan(firstOf('main.1.log'))
    expect(firstOf('main.1.log')).toBeLessThan(firstOf('main.log'))
  })

  it('打开已有的 main.log 接着写，已有大小计入轮转判断', () => {
    writeFileSync(join(dir, 'main.log'), 'x'.repeat(190) + '\n')
    const log = new LogFile({ maxBytes: 200, keep: 3, now: fixedNow })
    log.open(dir)
    log.write('INFO', '新的一行')
    expect(existsSync(join(dir, 'main.1.log'))).toBe(true)
    expect(lines(join(dir, 'main.log'))).toEqual(['2026-09-23 18:20:31.045 INFO  新的一行'])
  })

  it('写不进去（目录其实是个文件）只丢日志、不抛；缓冲有上限，open 之前的日志太多只留最新的', () => {
    const notADir = join(dir, 'occupied')
    writeFileSync(notADir, '')
    const broken = new LogFile({ maxBytes: 1024, keep: 3, now: fixedNow })
    expect(() => broken.open(notADir)).not.toThrow()
    expect(() => broken.write('ERROR', 'x')).not.toThrow()

    const log = new LogFile({ maxBytes: 1024 * 1024, keep: 3, now: fixedNow, maxBuffered: 2 })
    log.write('INFO', 'a')
    log.write('INFO', 'b')
    log.write('INFO', 'c')
    log.open(dir)
    expect(lines(join(dir, 'main.log')).map((l) => l.slice(-1))).toEqual(['b', 'c'])
  })
})
