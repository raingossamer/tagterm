/**
 * 纯函数：把 hook 载荷里的 cwd 映射到会话。归一化（小写、统一反斜杠、去尾分隔符）后与 session.cwd 或运行时 cwdNow 比较；
 * 多个命中时优先 agent 已是目标工具的会话，仍歧义则全部返回（启动后进程树首轮前可能标两个会话，可接受），零命中空数组。
 */
import type { AgentKind, Session, SessionRuntime } from '@shared/models'

export function normalizeCwd(cwd: string): string {
  return cwd.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function matchSessionsByCwd(
  cwd: unknown,
  sessions: readonly Session[],
  runtimes: readonly SessionRuntime[],
  preferAgent?: AgentKind,
): string[] {
  if (typeof cwd !== 'string' || !cwd) return []
  const target = normalizeCwd(cwd)
  const runtimeOf = new Map(runtimes.map((r) => [r.sessionId, r]))
  const hits = sessions.filter((s) => {
    if (normalizeCwd(s.cwd) === target) return true
    const cwdNow = runtimeOf.get(s.id)?.cwdNow
    return cwdNow !== undefined && normalizeCwd(cwdNow) === target
  })
  if (hits.length > 1 && preferAgent) {
    const preferred = hits.filter((s) => runtimeOf.get(s.id)?.agent === preferAgent)
    if (preferred.length > 0) return preferred.map((s) => s.id)
  }
  return hits.map((s) => s.id)
}
