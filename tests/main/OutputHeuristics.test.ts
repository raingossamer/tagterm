import { describe, expect, it } from 'vitest'
import { classify, isShellPrompt, parsePromptCwd } from '../../src/main/agent/OutputHeuristics'

describe('OutputHeuristics（屏幕末尾启发式，纯函数）', () => {
  it('classify：清单里的每种提示模式各一例命中，hint 是那一行；大小写不敏感；末尾空行跳过', () => {
    const samples = [
      'Overwrite? (y/n)',
      'Continue [y/n]',
      'Apply changes? [Y/n]',
      'Delete branch? (yes/no)',
      'Allow execution?',
      '  allow once  ',
      'Yes, allow this tool',
      'Do you want to proceed?',
      'Would you like to continue?',
      'Proceed with installation?',
      'Press Enter to continue',
      '❯ 1. Yes',
      '▶ Run command',
    ]
    for (const line of samples) {
      expect(classify(['some output', line])).toEqual({ kind: 'blocked', hint: line.trim() })
    }
    expect(classify(['DO YOU WANT to run this?'])).toEqual({
      kind: 'blocked',
      hint: 'DO YOU WANT to run this?',
    })
    expect(classify(['Allow?', '', '   ', ''])).toEqual({ kind: 'blocked', hint: 'Allow?' })
  })

  it('classify：末尾任一行含工具的「工作中」提示（esc to interrupt / esc to cancel，大小写不敏感）→ working；末行命中提示模式优先 blocked；末行是 shell 提示符一律 quiet', () => {
    // Claude Code：spinner 行在输入框与状态栏之上
    expect(
      classify([
        '✻ Cogitating… (esc to interrupt · 12s)',
        '> ',
        '? for shortcuts',
        '[Opus] | repo',
      ]),
    ).toEqual({ kind: 'working' })
    // Codex
    expect(classify(['• Working (5s • esc to interrupt)', '› '])).toEqual({ kind: 'working' })
    // Gemini CLI
    expect(classify(['⠋ Thinking... (ESC to cancel, 3s)', '> Type your message'])).toEqual({
      kind: 'working',
    })
    // 提示消失（跑完）→ quiet；在工具里打字 / 欢迎画面 → quiet
    expect(classify(['✻ Cogitated for 42s · done 10:49', '> ', '? for shortcuts'])).toEqual({
      kind: 'quiet',
    })
    expect(classify(['Welcome to Claude Code!', '> 正在打字'])).toEqual({ kind: 'quiet' })
    // 末行是「等你确认」提示：blocked 优先于工作中提示
    expect(classify(['• Working (5s • esc to interrupt)', 'Allow command? (y/n)'])).toEqual({
      kind: 'blocked',
      hint: 'Allow command? (y/n)',
    })
    // 回到 shell 提示符：回滚区里残留的提示不算
    expect(classify(['✻ Thinking… (esc to interrupt)', 'C:\\repo>'])).toEqual({ kind: 'quiet' })
  })

  it('classify：末行是 cmd / PowerShell 提示符 → quiet（提示符里的 > 不算提示）；普通输出 / 空 → quiet', () => {
    expect(classify(['Allow execution?', 'C:\\Users\\k>'])).toEqual({ kind: 'quiet' })
    expect(classify(['PS D:\\x>'])).toEqual({ kind: 'quiet' })
    expect(classify(['PS D:\\x> '])).toEqual({ kind: 'quiet' })
    expect(classify(['Compiling 12 files...'])).toEqual({ kind: 'quiet' })
    expect(classify([])).toEqual({ kind: 'quiet' })
    expect(classify(['', '  '])).toEqual({ kind: 'quiet' })
  })

  it('isShellPrompt：cmd 盘符提示符、PowerShell 提示符为真，其他为假', () => {
    expect(isShellPrompt('C:\\a\\b>')).toBe(true)
    expect(isShellPrompt('d:\\>')).toBe(true)
    expect(isShellPrompt('PS C:\\Users\\k>')).toBe(true)
    expect(isShellPrompt('PS D:\\x> ')).toBe(true)
    expect(isShellPrompt('C:\\a\\b> dir')).toBe(false)
    expect(isShellPrompt('❯ ')).toBe(false)
    expect(isShellPrompt('> ')).toBe(false)
  })

  it('parsePromptCwd：从末尾往前找第一个提示符行取目录；cmd 与 PowerShell；无提示符 → null；pwsh 同 PowerShell', () => {
    expect(parsePromptCwd(['C:\\a\\b>'])).toBe('C:\\a\\b')
    expect(parsePromptCwd(['C:\\a\\b>dir', 'x.txt', 'C:\\a>'])).toBe('C:\\a')
    expect(parsePromptCwd(['PS D:\\x>'])).toBe('D:\\x')
    expect(parsePromptCwd(['PS D:\\x\\y> '])).toBe('D:\\x\\y')
    // 末行不是提示符（程序在跑）时往前找最近的一个
    expect(parsePromptCwd(['C:\\Windows>ping 1.1.1.1', 'Pinging...'])).toBe('C:\\Windows')
    expect(parsePromptCwd(['hello', 'world'])).toBeNull()
    expect(parsePromptCwd([])).toBeNull()
    // cmd 会话里的 PowerShell 提示符（用户手动进了 powershell）同样能解析，反之亦然
    expect(parsePromptCwd(['PS C:\\q>'])).toBe('C:\\q')
    expect(parsePromptCwd(['C:\\q>'])).toBe('C:\\q')
  })
})
