import { describe, expect, it } from 'vitest'
import { detectAgent, type ProcessNode } from '../../src/main/agent/processMatch'

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
