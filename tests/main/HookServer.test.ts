import { afterEach, describe, expect, it } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import type { HookAgent } from '@shared/ipc'
import { HookServer } from '../../src/main/agent/HookServer'

interface Response {
  status: number
  body: string
}

function post(port: number, path: string, body: string, method = 'POST'): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          data += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('HookServer（回环 HTTP，接收 Claude / Codex hooks 的 stdin JSON）', () => {
  let hooks: Array<[HookAgent, unknown]>
  let server: HookServer | null = null
  let blocker: Server | null = null

  afterEach(async () => {
    await server?.stop()
    server = null
    await new Promise<void>((r) => (blocker ? blocker.close(() => r()) : r()))
    blocker = null
  })

  function start(preferred: number): Promise<number> {
    hooks = []
    server = new HookServer({ onHook: (agent, payload) => hooks.push([agent, payload]) })
    return server.start(preferred)
  }

  it('POST 合法 JSON 到 /tagterm/hook/claude 与 /codex → 204 且回调带来源与载荷；坏 JSON → 400 不回调；GET / 其他路径 → 404', async () => {
    const port = await start(0)
    expect(port).toBeGreaterThan(0)

    const claude = { hook_event_name: 'Stop', cwd: 'C:/x', session_id: 'abc' }
    expect(await post(port, '/tagterm/hook/claude', JSON.stringify(claude))).toEqual({
      status: 204,
      body: '',
    })
    const codex = { hook_event_name: 'PermissionRequest', cwd: 'C:/y', tool_name: 'shell' }
    expect((await post(port, '/tagterm/hook/codex', JSON.stringify(codex))).status).toBe(204)
    expect(hooks).toEqual([
      ['claude', claude],
      ['codex', codex],
    ])

    expect((await post(port, '/tagterm/hook/claude', '{ not json')).status).toBe(400)
    expect((await post(port, '/tagterm/hook/claude', '[1,2]')).status).toBe(400)
    expect((await post(port, '/tagterm/hook/claude', '', 'GET')).status).toBe(404)
    expect((await post(port, '/tagterm/hook/gemini', '{}')).status).toBe(404)
    expect((await post(port, '/other', '{}')).status).toBe(404)
    expect(hooks).toHaveLength(2)
  })

  it('请求体超过 64 KB → 413 不回调', async () => {
    const port = await start(0)
    const big = JSON.stringify({ hook_event_name: 'Stop', pad: 'x'.repeat(70 * 1024) })
    expect((await post(port, '/tagterm/hook/claude', big)).status).toBe(413)
    expect(hooks).toEqual([])
  })

  it('首选端口被占用时顺延并返回实际端口；stop 后端口释放', async () => {
    blocker = createServer()
    await new Promise<void>((r) => blocker!.listen(0, '127.0.0.1', () => r()))
    const taken = (blocker.address() as { port: number }).port

    const port = await start(taken)
    expect(port).not.toBe(taken)
    expect(port).toBeGreaterThan(taken)
    expect((await post(port, '/tagterm/hook/claude', '{"hook_event_name":"Stop"}')).status).toBe(
      204,
    )

    await server!.stop()
    server = null
    await expect(post(port, '/tagterm/hook/claude', '{}')).rejects.toThrow()
  })
})
