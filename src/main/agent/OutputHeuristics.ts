/**
 * 纯函数：屏幕末尾启发式（给没有 hooks 的工具兜底）。
 * classify：末行是 shell 提示符 → quiet（回到 shell 了，回滚区里残留的提示不算）；末行命中提示模式 → blocked（hint = 那一行）；
 *   否则末尾任一行含工具自己的「工作中」提示 → working；都不是 → quiet。
 *   「运行中」只认这条提示，不认「有输出到达」：启动工具的欢迎画面、在工具里打字、界面重绘都会有输出，但都不是在干活（用户 2026-09-18）。
 * parsePromptCwd：从末尾往前找第一个 cmd / PowerShell 提示符行，取目录（路径条显示「当前目录」用）。
 * 输入是渲染进程从 xterm 活动缓冲区读来的末尾几行，主进程从不记录它们（规范：不记录终端内容）。
 */
export type OutputClass =
  { kind: 'blocked'; hint: string } | { kind: 'working' } | { kind: 'quiet' }

/**
 * 工具工作全程显示在屏幕上的「工作中」提示（大小写不敏感，子串匹配）：
 * Claude Code / Codex 的 spinner 行带 `esc to interrupt`，Gemini CLI 带 `esc to cancel`。pi 的文案未核实
 */
const WORKING_PATTERNS: readonly RegExp[] = [/esc to interrupt/i, /esc to cancel/i]

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
  if (PROMPT_PATTERNS.some((p) => p.test(line))) return { kind: 'blocked', hint: line }
  if (tail.some((l) => WORKING_PATTERNS.some((p) => p.test(l)))) return { kind: 'working' }
  return { kind: 'quiet' }
}

/**
 * 从末尾往前找第一个提示符行取目录。两种提示符都认、不按会话 shell 区分：用户在 cmd 里手动进 powershell（或反过来）
 * 时提示符会换样子，按会话 shell 死扣反而解析不到
 */
export function parsePromptCwd(tail: readonly string[]): string | null {
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const line = tail[i]!
    // 提示符后面可能跟着正在输入 / 已执行的命令（`C:\a>dir`）：只认目录部分
    const m = /^(?:PS )?([A-Za-z]:\\[^>\r\n]*)>/.exec(line)
    if (m) return m[1]!.trimEnd()
  }
  return null
}
