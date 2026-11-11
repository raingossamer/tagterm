/**
 * 纯函数：一条 hook 请求来自哪个终端。hooks 命令是 `curl.exe … http://127.0.0.1:<port>/tagterm/hook/<agent>`，
 * 请求到达、应答之前 curl 还活着：在全机进程表里找命令行带本端点的 curl，顺着父进程链往上走，落在哪个终端的 shell 底下
 * 就是哪个会话（本机 claude-code 2.1.321 实测链路：curl ← bash ← bash ← claude.exe ← cmd.exe（终端 shell）← TagTerm.exe）。
 * 此前按载荷里的 cwd 找会话：父目录会话里的工具 cd 进子目录、TagTerm 之外同目录跑的工具，事件都会记到别的会话头上。
 * 判据是进程祖先关系（自证信号），不看文案；命令行只用来认出「发往本端点的 curl」。不 import electron。
 */
import { HOOK_PATH_PREFIX } from './hookContract'
import type { ProcessNode } from './processMatch'

export type HookOrigin =
  /** 发请求的 curl 落在这些会话的终端底下（多数时候一个；同一瞬间几个终端都在发时是多个，按 shells 的顺序） */
  | { kind: 'sessions'; sessionIds: string[] }
  /** 找到了发往本端点的 curl，但都不在任何终端底下：TagTerm 之外跑的工具，事件与我们无关 */
  | { kind: 'outside' }
  /** 进程表里没有发往本端点的 curl（查询落空、命令被改过、不经 curl 的请求）：进程这条路给不出结论 */
  | { kind: 'unknown' }

/** shells：会话 id → 该会话终端的 shell pid；port：本实例 hooks 端点的端口（别的实例的 curl 不算） */
export function attributeHook(
  processes: readonly ProcessNode[],
  shells: ReadonlyMap<string, number>,
  port: number,
): HookOrigin {
  const marker = `:${port}${HOOK_PATH_PREFIX}`
  const curls = processes.filter(
    (p) => p.name.toLowerCase() === 'curl.exe' && (p.commandLine ?? '').includes(marker),
  )
  if (curls.length === 0) return { kind: 'unknown' }

  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const sessionOfShell = new Map([...shells].map(([sessionId, pid]) => [pid, sessionId]))
  const found = new Set<string>()
  for (const curl of curls) {
    const visited = new Set<number>() // 防 pid 复用造成的父链成环
    let current: ProcessNode | undefined = curl
    while (current && !visited.has(current.pid)) {
      visited.add(current.pid)
      const sessionId = sessionOfShell.get(current.ppid)
      if (sessionId !== undefined) {
        found.add(sessionId)
        break
      }
      current = byPid.get(current.ppid)
    }
  }
  if (found.size === 0) return { kind: 'outside' }
  return { kind: 'sessions', sessionIds: [...shells.keys()].filter((id) => found.has(id)) }
}
