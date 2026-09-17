import { describe, expect, it } from 'vitest'
import type { Session, SessionRuntime } from '@shared/models'
import { matchSessionsByCwd, normalizeCwd } from '../../src/main/agent/hookMatch'

function session(id: string, cwd: string): Session {
  return { id, name: id, cwd, shell: 'cmd.exe', sortOrder: 1, createdAt: '2026-09-17T00:00:00Z' }
}
function runtime(sessionId: string, partial: Partial<SessionRuntime> = {}): SessionRuntime {
  return { sessionId, alive: true, agent: null, status: 'idle', ...partial }
}

describe('hookMatch（hook 载荷的 cwd → 会话）', () => {
  it('normalizeCwd：小写、正斜杠统一成反斜杠、去掉尾分隔符', () => {
    expect(normalizeCwd('C:/Users/K/Proj/')).toBe('c:\\users\\k\\proj')
    expect(normalizeCwd('C:\\Users\\k\\proj\\')).toBe('c:\\users\\k\\proj')
    expect(normalizeCwd('D:\\')).toBe('d:')
    expect(normalizeCwd('')).toBe('')
  })

  it('按归一化后的 cwd 命中 session.cwd 或 cwdNow；零命中空数组；空 cwd 不命中任何会话', () => {
    const sessions = [session('a', 'C:\\Proj\\A'), session('b', 'C:\\Proj\\B')]
    const runtimes = [runtime('a'), runtime('b', { cwdNow: 'C:\\Proj\\B\\sub' })]
    expect(matchSessionsByCwd('c:/proj/a/', sessions, runtimes)).toEqual(['a'])
    expect(matchSessionsByCwd('C:\\Proj\\B\\sub', sessions, runtimes)).toEqual(['b'])
    expect(matchSessionsByCwd('C:\\Proj\\C', sessions, runtimes)).toEqual([])
    expect(matchSessionsByCwd('', sessions, runtimes)).toEqual([])
    expect(matchSessionsByCwd(undefined, sessions, runtimes)).toEqual([])
  })

  it('多命中：优先 agent 是目标工具的会话；仍歧义则全部返回；会话没有运行时记录也能按固定目录命中', () => {
    const sessions = [session('a', 'C:\\Proj'), session('b', 'C:\\Proj'), session('c', 'C:\\Proj')]
    const runtimes = [runtime('a', { agent: 'gemini' }), runtime('b', { agent: 'claude' })]
    expect(matchSessionsByCwd('C:\\Proj', sessions, runtimes, 'claude')).toEqual(['b'])
    expect(matchSessionsByCwd('C:\\Proj', sessions, runtimes, 'codex')).toEqual(['a', 'b', 'c'])
    expect(
      matchSessionsByCwd(
        'C:\\Proj',
        sessions,
        [runtime('a', { agent: 'codex' }), runtime('c', { agent: 'codex' })],
        'codex',
      ),
    ).toEqual(['a', 'c'])
    expect(matchSessionsByCwd('C:\\Proj', sessions, [])).toEqual(['a', 'b', 'c'])
  })
})
