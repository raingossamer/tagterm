/**
 * 纯函数：把一个 pty 的进程子树映射成「当前在哪个工具里」。
 * claude.exe / codex.exe 按进程名；node.exe 按命令行里的包路径（gemini-cli / pi-coding-agent / @openai/codex /
 * @anthropic-ai/claude-code）。同树多命中时 claude > codex > gemini > pi（codex 的 node 包装 + codex.exe 同树本就都是 codex）。
 * 另有 foregroundProgram：不论认不认得，shell 下正在跑的程序叫什么（认不出的程序也算「有程序在跑」）。
 */
import type { AgentKind } from '@shared/models'

/** 进程树探针给出的一个进程（不含 pty 的 shell 自己） */
export interface ProcessNode {
  pid: number
  ppid: number
  name: string
  commandLine?: string
}

const PRIORITY: readonly AgentKind[] = ['claude', 'codex', 'gemini', 'pi']

/** node.exe 命令行里的包路径特征（统一成正斜杠、小写后比较） */
const NODE_SCRIPT_HINTS: ReadonlyArray<[hint: string, agent: AgentKind]> = [
  ['@anthropic-ai/claude-code', 'claude'],
  ['@openai/codex', 'codex'],
  ['gemini-cli', 'gemini'],
  ['pi-coding-agent', 'pi'],
]

function agentOf(node: ProcessNode): AgentKind | null {
  const name = node.name.toLowerCase()
  if (name === 'claude.exe') return 'claude'
  if (name === 'codex.exe') return 'codex'
  if (name !== 'node.exe' || !node.commandLine) return null
  const commandLine = node.commandLine.replace(/\\/g, '/').toLowerCase()
  for (const [hint, agent] of NODE_SCRIPT_HINTS) if (commandLine.includes(hint)) return agent
  return null
}

/** 进程名 → 显示用的程序名：去掉 .exe、统一小写（映像名大小写不一，如 PING.EXE） */
function programName(node: ProcessNode): string {
  return node.name.toLowerCase().replace(/\.exe$/, '')
}

/** 只是代跑别的程序的外壳：PowerShell 里敲 npm 时 npm.cmd 由 cmd.exe 代跑，真正在跑的是它下面的 node */
const WRAPPER_SHELLS = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe'])

/**
 * shell 下正在跑的程序名（唤起区置灰的悬停提示、重启终端的确认用）：shell 的直接子进程（多个取第一个）；
 * 它若是外壳且下面还有进程就往下剥，直到不是外壳为止 —— 下面没有进程的外壳（在终端里另开的交互 shell）本身就是在跑的程序。
 * 没有子进程为 null。子树不含 shell 自己，按 ppid 找孩子。
 */
export function foregroundProgram(
  subtree: readonly ProcessNode[],
  shellPid: number,
): string | null {
  const firstChildOf = (pid: number): ProcessNode | undefined => subtree.find((n) => n.ppid === pid)
  let current = firstChildOf(shellPid)
  if (!current) return null
  const visited = new Set<number>([shellPid]) // 防 pid 复用造成的 ppid 环
  while (WRAPPER_SHELLS.has(current.name.toLowerCase()) && !visited.has(current.pid)) {
    visited.add(current.pid)
    const inner = firstChildOf(current.pid)
    if (!inner) break
    current = inner
  }
  return programName(current)
}

export function detectAgent(subtree: readonly ProcessNode[]): AgentKind | null {
  const found = new Set<AgentKind>()
  for (const node of subtree) {
    const agent = agentOf(node)
    if (agent) found.add(agent)
  }
  return PRIORITY.find((agent) => found.has(agent)) ?? null
}
