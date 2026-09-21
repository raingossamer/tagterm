import { describe, expect, it } from 'vitest'
import {
  classify,
  hasCountedDown,
  hasTicked,
  isShellPrompt,
  parseElapsedSeconds,
  parsePromptCwd,
  parseRetryCountdown,
} from '../../src/main/agent/OutputHeuristics'

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

  it('parseElapsedSeconds：只认括号里的耗时（工具状态行的计时器），h / m / s 折成秒；跑完那行的「for 8m 39s」不在括号里不算；屏幕上提到的文案不算', () => {
    // Claude Code 工作中的状态行（截图实测形态，2.1.258 不带 esc to interrupt）
    expect(parseElapsedSeconds(['✻ Bloviating… (3m 12s · ↓ 3.6k tokens)', '> '])).toEqual([192])
    expect(
      parseElapsedSeconds(['✻ Envisioning… (19s · still thinking with xhigh effort)']),
    ).toEqual([19])
    // Gemini CLI：括号里先有文字再有秒数
    expect(parseElapsedSeconds(['⠋ Thinking... (ESC to cancel, 3s)'])).toEqual([3])
    // 小时 / 分钟 / 秒都折成秒；一行里多个括号按出现顺序
    expect(parseElapsedSeconds(['(1h 2m 3s)', 'x (4s) y (2m)'])).toEqual([3723, 4])
    // 跑完那行：耗时不在括号里 → 不算计时器（否则永远「在走」）
    expect(parseElapsedSeconds(['✻ Cooked for 8m 39s · done 13:57', '> '])).toEqual([])
    // 屏幕上正好写着提示文案（我自己解释这件事、看代码、写文档）→ 不是计时器
    expect(parseElapsedSeconds(['末尾任一行含 esc to interrupt 就算运行中', '> '])).toEqual([])
    expect(parseElapsedSeconds([])).toEqual([])
  })

  it('hasTicked：新采样里出现比上次某个值大 1–4 秒的耗时 → 计时器在走；值没变（静态文字）、值变少（滚出屏幕）、跳得太远都不算', () => {
    expect(hasTicked([19], [20])).toBe(true) // 正常一秒一跳
    expect(hasTicked([191, 38], [192, 38])).toBe(true) // 活的计时器 + 静态的 (38s) 并存
    expect(hasTicked([19], [23])).toBe(true) // 采样抖动（≤ 4 s）
    expect(hasTicked([19], [19])).toBe(false) // 静态：一个字都没动
    expect(hasTicked([191, 38], [191])).toBe(false) // 静态行滚出屏幕
    expect(hasTicked([19], [99])).toBe(false) // 跳太远：不是同一个计时器
    expect(hasTicked([19], [18])).toBe(false) // 倒退
    expect(hasTicked([], [19])).toBe(false) // 没有上次的值可比
    expect(hasTicked([19], [])).toBe(false)
  })

  it('parseRetryCountdown：只认含 retry / next try / reconnect 字样的行里、不在括号内的时长读数（Claude Code 2.1.258 三种重试横幅的实测形态）；括号内的耗时归计时器；没有这些字样的行不算', () => {
    // 网络断（stalled 横幅）
    expect(
      parseRetryCountdown([
        'Waiting for API response · will retry in 5s · check your network',
        '> ',
      ]),
    ).toEqual([5])
    // API 出错重试：h / m / s 折成秒；同一行的「attempt 2/10」不是时长
    expect(parseRetryCountdown(['Connection error. · Retrying in 1m 4s · attempt 2/10'])).toEqual([
      64,
    ])
    // 低优先级排队横幅
    expect(
      parseRetryCountdown(['Usage limit reached · next try in 12s · attempt 3 · esc to interrupt']),
    ).toEqual([12])
    // 大小写不敏感；「4 seconds」也认
    expect(parseRetryCountdown(['RECONNECTING in 3s'])).toEqual([3])
    expect(parseRetryCountdown(['Retrying in 4 seconds…'])).toEqual([4])
    // 括号内的耗时属于计时器：带 retry 字样的工作状态行不会被当成倒数
    expect(parseRetryCountdown(['✻ Retrying tool… (19s · ↓ 1.2k tokens)'])).toEqual([])
    // 同一行括号外与括号内并存：只取括号外
    expect(parseRetryCountdown(['Retrying in 5s (elapsed 19s)'])).toEqual([5])
    // 没有 retry 字样的时长不算（跑完那行、普通文字）
    expect(parseRetryCountdown(['✻ Cooked for 8m 39s · done 13:57', 'sleep 5s'])).toEqual([])
    expect(parseRetryCountdown([])).toEqual([])
  })

  it('hasCountedDown：新采样里出现比上次某个值小 1–4 秒的读数 → 倒数在走；值没变（静态引用的横幅文字）、消失（滚出屏幕）、跳太远、变大都不算', () => {
    expect(hasCountedDown([5], [4])).toBe(true) // 正常一秒一减
    expect(hasCountedDown([64], [61])).toBe(true) // 采样抖动（≤ 4 s）
    expect(hasCountedDown([5, 30], [4, 30])).toBe(true) // 活的倒数 + 静态的 30s 并存
    expect(hasCountedDown([5], [5])).toBe(false) // 静态：聊天里引用的一句「Retrying in 5s」
    expect(hasCountedDown([5, 30], [30])).toBe(false) // 倒数那行滚出屏幕
    expect(hasCountedDown([64], [4])).toBe(false) // 跳太远：不是同一个倒数
    expect(hasCountedDown([4], [5])).toBe(false) // 变大：那是计时器，不是倒数
    expect(hasCountedDown([], [5])).toBe(false) // 没有上次的值可比
    expect(hasCountedDown([5], [])).toBe(false)
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
