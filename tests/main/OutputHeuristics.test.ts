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
    expect(parsePromptCwd(['C:\\a\\b>'], 'cmd.exe')).toBe('C:\\a\\b')
    expect(parsePromptCwd(['C:\\a\\b>dir', 'x.txt', 'C:\\a>'], 'cmd.exe')).toBe('C:\\a')
    expect(parsePromptCwd(['PS D:\\x>'], 'powershell.exe')).toBe('D:\\x')
    expect(parsePromptCwd(['PS D:\\x\\y> '], 'pwsh.exe')).toBe('D:\\x\\y')
    // 末行不是提示符（程序在跑）时往前找最近的一个
    expect(parsePromptCwd(['C:\\Windows>ping 1.1.1.1', 'Pinging...'], 'cmd.exe')).toBe(
      'C:\\Windows',
    )
    expect(parsePromptCwd(['hello', 'world'], 'cmd.exe')).toBeNull()
    expect(parsePromptCwd([], 'cmd.exe')).toBeNull()
    // cmd 会话里的 PowerShell 提示符（用户手动进了 powershell）同样能解析，反之亦然
    expect(parsePromptCwd(['PS C:\\q>'], 'cmd.exe')).toBe('C:\\q')
    expect(parsePromptCwd(['C:\\q>'], 'powershell.exe')).toBe('C:\\q')
  })
})
