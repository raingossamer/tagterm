import { describe, expect, it } from 'vitest'
import { request } from 'node:http'
import type { SessionRuntime } from '@shared/models'
import { HOOK_AGENTS, HOOK_CONTRACTS, HOOK_PATH_PREFIX } from '../../src/main/agent/hookContract'
import { HookServer } from '../../src/main/agent/HookServer'
import { buildHookCommand, isOurHook } from '../../src/main/agent/hookSettings'

/** 共通规则由 AgentDetector 处理，契约表的 interpret 不认它们 */
const COMMON_EVENTS = new Set(['SessionStart', 'SessionEnd'])

const working: SessionRuntime = { sessionId: 's1', alive: true, agent: 'claude', status: 'working' }

describe('hookContract（装什么 = 识别什么 = 处理什么）', () => {
  it('HOOK_AGENTS 就是契约表的键；每个 agent 安装表里的每个事件都被 interpret 处理，或属于共通规则', () => {
    expect([...HOOK_AGENTS].sort()).toEqual(Object.keys(HOOK_CONTRACTS).sort())
    for (const agent of HOOK_AGENTS) {
      const contract = HOOK_CONTRACTS[agent]
      expect(contract.agent).toBe(agent)
      expect(contract.events.length).toBeGreaterThan(0)
      for (const spec of contract.events) {
        if (COMMON_EVENTS.has(spec.event)) continue
        // 用一份最可能触发转移的载荷试探：能转移就说明安装的事件确实有人处理
        const payload: Record<string, unknown> = {
          hook_event_name: spec.event,
          notification_type: spec.matcher?.split('|')[0],
          message: 'm',
          tool_name: 'shell',
        }
        const next = contract.interpret(
          spec.event,
          payload,
          { ...working, agent },
          { isViewed: false },
        )
        expect(next, `${agent} 安装了 ${spec.event} 却不处理它`).not.toBeNull()
      }
    }
  })

  it('Claude 的 Notification：安装表 matcher 里的类型集合 = interpret 认作「等你确认」的类型集合；其他类型不转移', () => {
    const { events, interpret } = HOOK_CONTRACTS.claude
    const matcher = events.find((e) => e.event === 'Notification')?.matcher ?? ''
    const installed = matcher.split('|').sort()
    expect(installed.length).toBeGreaterThan(0)
    const handled = [...installed, 'idle_prompt', 'auth_success', ''].filter(
      (type) =>
        interpret('Notification', { notification_type: type, message: 'm' }, working, {
          isViewed: false,
        })?.status === 'blocked',
    )
    expect(handled.sort()).toEqual(installed)
  })

  it('命令串指向契约前缀且 isOurHook 认得；HookServer 只给契约表里的来源 204，其他来源 404', async () => {
    for (const agent of HOOK_AGENTS) {
      const cmd = buildHookCommand(agent, 51233, 'Stop')
      expect(cmd).toContain(`${HOOK_PATH_PREFIX}${agent}`)
      expect(isOurHook(cmd)).toBe(true)
    }
    const hooks: string[] = []
    const server = new HookServer({ onHook: (agent) => hooks.push(agent) })
    const port = await server.start(0)
    try {
      for (const agent of HOOK_AGENTS) {
        expect(await post(port, `${HOOK_PATH_PREFIX}${agent}`)).toBe(204)
      }
      expect(await post(port, `${HOOK_PATH_PREFIX}gemini`)).toBe(404)
      expect(hooks).toEqual([...HOOK_AGENTS])
    } finally {
      await server.stop()
    }
  })
})

function post(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST' }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end('{"hook_event_name":"Stop"}')
  })
}
