/**
 * 纯函数：把一个 pty 的进程子树映射成「当前在哪个工具里」。
 * claude.exe / codex.exe 按进程名；node.exe 按命令行里的包路径（gemini-cli / pi-coding-agent / @openai/codex /
 * @anthropic-ai/claude-code）。同树多命中时 claude > codex > gemini > pi（codex 的 node 包装 + codex.exe 同树本就都是 codex）。
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

export function detectAgent(subtree: readonly ProcessNode[]): AgentKind | null {
  const found = new Set<AgentKind>()
  for (const node of subtree) {
    const agent = agentOf(node)
    if (agent) found.add(agent)
  }
  return PRIORITY.find((agent) => found.has(agent)) ?? null
}
