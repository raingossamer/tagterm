/**
 * 纯函数：屏幕末尾启发式（给没有 hooks 的工具兜底）。
 * classify：末行是 shell 提示符 → quiet（回到 shell 了，回滚区里残留的提示不算）；末行命中提示模式 → blocked（hint = 那一行）；否则 quiet。
 * parseElapsedSeconds + hasTicked：「运行中」的信号 —— 屏幕上有个**在走的计时器**（工具状态行括号里的耗时），
 *   由 AgentDetector 拿相邻两次采样比较。不认「有输出到达」（启动画面 / 打字 / 重绘都有输出但不是在干活），
 *   也不认任何固定文案 —— 2026-09-18 实测：claude-code 2.1.258 工作时的状态行是 `✻ Bloviating… (3m 12s · ↓ 3.6k tokens)`，
 *   根本不显示 `esc to interrupt`（该串只在它的「重试等待」横幅里），而按文案匹配又会被屏幕上任何提到该文案的文字
 *   （解释这件事的聊天、源码、文档）永久钉在运行中。计时器必须真的在走，二者都不会误判。
 * parsePromptCwd：从末尾往前找第一个 cmd / PowerShell 提示符行，取目录（路径条显示「当前目录」用）。
 * 输入是渲染进程从 xterm 活动缓冲区读来的末尾几行，主进程从不记录它们（规范：不记录终端内容）。
 */
export type OutputClass = { kind: 'blocked'; hint: string } | { kind: 'quiet' }

/**
 * 工具状态行的计时器：**括号里**的耗时，秒数必给（`(19s …`、`(3m 12s …`、Gemini 的 `(ESC to cancel, 3s)`）。
 * 括号是关键的降噪条件：跑完那行的「Cooked for 8m 39s · done 13:57」不在括号里，不会被当成计时器。
 * 括号内允许秒数前有一小段不含数字的文字（Gemini 那种）
 */
const ELAPSED_IN_PARENS = /\((?:[^()\d]{0,24})?(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(\d+)\s*s\b/g

/** 相邻两次采样间计时器最多认几秒的前进：正常一秒一跳，留点抖动余量；跳太远说明不是同一个计时器 */
const MAX_TICK_STEP = 4

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

/** 这一屏里所有计时器读数（秒），按出现顺序；没有返回空数组 */
export function parseElapsedSeconds(tail: readonly string[]): number[] {
  const out: number[] = []
  for (const line of tail) {
    for (const m of line.matchAll(ELAPSED_IN_PARENS)) {
      const [, h, min, s] = m
      out.push(Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s))
    }
  }
  return out
}

/**
 * 计时器是否在走：新采样里出现了「比上次某个读数大 1…MAX_TICK_STEP 秒、且上次没有过」的读数。
 * 静态文字每次读数一模一样 → 不算；行滚出屏幕只会让读数变少 → 不算；工具停下来后状态行换成「跑完」文案 → 读数消失 → 不算
 */
export function hasTicked(prev: readonly number[], next: readonly number[]): boolean {
  if (prev.length === 0 || next.length === 0) return false
  const before = new Set(prev)
  return next.some((v) => !before.has(v) && prev.some((u) => v - u >= 1 && v - u <= MAX_TICK_STEP))
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
