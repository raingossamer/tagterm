import { describe, expect, it } from 'vitest'
import { detectAgent, foregroundProgram, type ProcessNode } from '../../src/main/agent/processMatch'

const node = (partial: Partial<ProcessNode> & { name: string }): ProcessNode => ({
  pid: 1,
  ppid: 0,
  ...partial,
})

describe('detectAgent（进程子树 → 工具）', () => {
  it('claude.exe / codex.exe 按进程名识别（大小写不敏感）', () => {
    expect(detectAgent([node({ name: 'claude.exe' })])).toBe('claude')
    expect(detectAgent([node({ name: 'Codex.EXE' })])).toBe('codex')
  })

  it('node.exe 按命令行识别 gemini-cli / pi-coding-agent / @openai/codex（正反斜杠都认）', () => {
    expect(
      detectAgent([
        node({
          name: 'node.exe',
          commandLine:
            'D:\\nvm\\node.exe D:\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js',
        }),
      ]),
    ).toBe('gemini')
    expect(
      detectAgent([
        node({
          name: 'node.exe',
          commandLine: 'node D:/npm/node_modules/@mariozechner/pi-coding-agent/dist/cli.js',
        }),
      ]),
    ).toBe('pi')
    expect(
      detectAgent([
        node({
          name: 'node.exe',
          commandLine: 'node D:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
        }),
      ]),
    ).toBe('codex')
  })

  it('无关的 node.exe / 空子树 → null；codex 的 node 包装 + codex.exe 同树只算 codex；claude 优先于其他', () => {
    expect(detectAgent([])).toBeNull()
    expect(detectAgent([node({ name: 'node.exe', commandLine: 'node build.js' })])).toBeNull()
    expect(detectAgent([node({ name: 'conhost.exe' }), node({ name: 'ping.exe' })])).toBeNull()
    expect(
      detectAgent([
        node({ pid: 2, name: 'node.exe', commandLine: 'node @openai/codex/bin/codex.js' }),
        node({ pid: 3, ppid: 2, name: 'codex.exe' }),
      ]),
    ).toBe('codex')
    expect(
      detectAgent([node({ pid: 2, name: 'claude.exe' }), node({ pid: 3, name: 'codex.exe' })]),
    ).toBe('claude')
  })
})

describe('foregroundProgram（shell 下正在跑的程序名）', () => {
  const SHELL = 100

  it('取 shell 的直接子进程：去掉 .exe、统一小写；没有子进程为 null', () => {
    expect(foregroundProgram([], SHELL)).toBeNull()
    expect(foregroundProgram([node({ pid: 101, ppid: SHELL, name: 'PING.EXE' })], SHELL)).toBe(
      'ping',
    )
    // 孙进程不改变结论：显示的是 shell 直接启动的那个程序
    expect(
      foregroundProgram(
        [
          node({ pid: 101, ppid: SHELL, name: 'node.exe', commandLine: 'node npm-cli.js run dev' }),
          node({ pid: 102, ppid: 101, name: 'esbuild.exe' }),
        ],
        SHELL,
      ),
    ).toBe('node')
  })

  it('直接子进程是外壳（cmd / powershell / pwsh）且下面还有进程时往下剥，直到不是外壳', () => {
    // PowerShell 里 npm run dev：npm.cmd 由 cmd.exe 代跑，真正的程序是它下面的 node
    expect(
      foregroundProgram(
        [
          node({ pid: 101, ppid: SHELL, name: 'cmd.exe', commandLine: 'cmd /c npm.cmd run dev' }),
          node({ pid: 102, ppid: 101, name: 'node.exe' }),
        ],
        SHELL,
      ),
    ).toBe('node')
    // 外壳套外壳
    expect(
      foregroundProgram(
        [
          node({ pid: 101, ppid: SHELL, name: 'pwsh.exe' }),
          node({ pid: 102, ppid: 101, name: 'PowerShell.exe' }),
          node({ pid: 103, ppid: 102, name: 'python.exe' }),
        ],
        SHELL,
      ),
    ).toBe('python')
    // 在终端里另开一个空闲的交互 shell：它自己就是在跑的程序
    expect(
      foregroundProgram([node({ pid: 101, ppid: SHELL, name: 'powershell.exe' })], SHELL),
    ).toBe('powershell')
  })

  it('直接子进程有多个时取第一个', () => {
    expect(
      foregroundProgram(
        [
          node({ pid: 101, ppid: SHELL, name: 'notepad.exe' }),
          node({ pid: 102, ppid: SHELL, name: 'ping.exe' }),
        ],
        SHELL,
      ),
    ).toBe('notepad')
  })
})
