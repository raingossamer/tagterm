import { describe, expect, it } from 'vitest'
import { attributeHook } from '../../src/main/agent/hookAttribution'
import type { ProcessNode } from '../../src/main/agent/processMatch'

const PORT = 56504
const hookCurl = (pid: number, ppid: number, port = PORT): ProcessNode => ({
  pid,
  ppid,
  name: 'curl.exe',
  commandLine: `curl.exe -s -m 3 --noproxy 127.0.0.1 -X POST -T - http://127.0.0.1:${port}/tagterm/hook/claude`,
})
const proc = (pid: number, ppid: number, name: string): ProcessNode => ({ pid, ppid, name })

/** 本机实测的链路（claude-code 2.1.321）：curl ← bash ← bash ← claude.exe ← cmd.exe（终端 shell）← TagTerm.exe */
const chainUnder = (shellPid: number, base: number): ProcessNode[] => [
  proc(shellPid, 1, 'cmd.exe'),
  proc(base, shellPid, 'claude.exe'),
  proc(base + 1, base, 'bash.exe'),
  proc(base + 2, base + 1, 'bash.exe'),
  hookCurl(base + 3, base + 2),
]

describe('attributeHook（hook 请求来自哪个终端，纯函数）', () => {
  const shells = new Map([
    ['s1', 100],
    ['s2', 200],
  ])

  it('发请求的 curl 顺着父进程链落在某个终端的 shell 底下 → 就是那个会话', () => {
    const processes = [...chainUnder(100, 1000), proc(200, 1, 'powershell.exe')]
    expect(attributeHook(processes, shells, PORT)).toEqual({ kind: 'sessions', sessionIds: ['s1'] })
  })

  it('两个终端同一瞬间都在发：两个会话都算候选（去重、按会话顺序）', () => {
    const processes = [
      ...chainUnder(200, 2000),
      ...chainUnder(100, 1000),
      hookCurl(1009, 1001), // 同一终端的第二个 curl
    ]
    expect(attributeHook(processes, shells, PORT)).toEqual({
      kind: 'sessions',
      sessionIds: ['s1', 's2'],
    })
  })

  it('找到了这样的 curl，但不在任何终端底下（别的程序里跑的 Claude）→ outside', () => {
    const processes = [
      proc(100, 1, 'cmd.exe'),
      proc(900, 1, 'Code.exe'),
      proc(901, 900, 'claude.exe'),
      hookCurl(902, 901),
    ]
    expect(attributeHook(processes, shells, PORT)).toEqual({ kind: 'outside' })
  })

  it('进程表里没有发往本端点的 curl → unknown：别的端口的、不带命令行的、不叫 curl 的都不算', () => {
    const processes = [
      proc(100, 1, 'cmd.exe'),
      hookCurl(101, 100, 49999), // 另一个 TagTerm 实例（烟测）的端点
      proc(102, 100, 'curl.exe'), // 拿不到命令行
      { ...hookCurl(103, 100), name: 'node.exe' },
    ]
    expect(attributeHook(processes, shells, PORT)).toEqual({ kind: 'unknown' })
    expect(attributeHook([], shells, PORT)).toEqual({ kind: 'unknown' })
  })

  it('进程名大小写不敏感；pid 复用造成的父链成环不会死循环，按不在终端底下处理', () => {
    const upper = [proc(100, 1, 'cmd.exe'), { ...hookCurl(101, 100), name: 'CURL.EXE' }]
    expect(attributeHook(upper, shells, PORT)).toEqual({ kind: 'sessions', sessionIds: ['s1'] })

    const loop = [proc(500, 501, 'bash.exe'), proc(501, 500, 'bash.exe'), hookCurl(502, 501)]
    expect(attributeHook(loop, shells, PORT)).toEqual({ kind: 'outside' })
  })
})
