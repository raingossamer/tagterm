/**
 * 纯函数：屏幕末尾启发式（给没有 hooks 的工具兜底）。
 * classify：末尾非空行命中提示模式 → blocked（hint = 那一行），末行是 shell 提示符或不命中 → quiet；
 * parsePromptCwd：从末尾往前找第一个 cmd / PowerShell 提示符行，取目录（路径条显示「当前目录」用）。
 * 输入是渲染进程从 xterm 活动缓冲区读来的末尾几行，主进程从不记录它们（规范：不记录终端内容）。
 */
import type { ShellKind } from '@shared/models'

export type OutputClass = { kind: 'blocked'; hint: string } | { kind: 'quiet' }

/** 「等你确认」的提示模式（大小写不敏感，子串匹配）；`>` 不在清单里 —— 它和 shell 提示符重叠 */
const PROMPT_PATTERNS: readonly RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\(yes\/no\)/i,
  /\ballow\b/i, // Allow / allow once / Yes, allow
  /\bdo you want\b/i,
  /\bwould you like\b/i,
  /\bproceed\b/i,
  /\bpress enter\b/i,
  /❯/,
  /▶/,
]

/** cmd 提示符 `C:\path>`；PowerShell 提示符 `PS C:\path>`；允许尾随空格 */
const CMD_PROMPT = /^([A-Za-z]:\\[^>\r\n]*)>\s*$/
const PS_PROMPT = /^PS ([A-Za-z]:\\[^>\r\n]*)>\s*$/

export function isShellPrompt(line: string): boolean {
  return CMD_PROMPT.test(line) || PS_PROMPT.test(line)
}

/** 末尾第一个非空行（去两侧空白）；没有返回 null */
function lastNonEmpty(tail: readonly string[]): string | null {
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const line = tail[i]!.trim()
    if (line) return line
  }
  return null
}

export function classify(tail: readonly string[]): OutputClass {
  const line = lastNonEmpty(tail)
  if (line === null || isShellPrompt(line)) return { kind: 'quiet' }
  return PROMPT_PATTERNS.some((p) => p.test(line))
    ? { kind: 'blocked', hint: line }
    : { kind: 'quiet' }
}

/**
 * 从末尾往前找第一个提示符行取目录。两种提示符都认、不按 shell 区分：用户在 cmd 里手动进 powershell（或反过来）
 * 时提示符会换样子，按会话 shell 死扣反而解析不到。shell 参数保留给将来只认某一种的场景
 */
export function parsePromptCwd(tail: readonly string[], _shell: ShellKind): string | null {
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const line = tail[i]!
    // 提示符后面可能跟着正在输入 / 已执行的命令（`C:\a>dir`）：只认目录部分
    const m = /^(?:PS )?([A-Za-z]:\\[^>\r\n]*)>/.exec(line)
    if (m) return m[1]!.trimEnd()
  }
  return null
}
