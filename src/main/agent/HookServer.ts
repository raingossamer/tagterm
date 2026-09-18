/**
 * 服务层：只绑 127.0.0.1 的小 HTTP 服务，接收 Claude Code / Codex hooks 经 curl 转发来的 stdin JSON。
 * POST /tagterm/hook/<agent>（路径即来源，认哪些 agent 见 hookContract）→ 204；坏 JSON / 非对象 400；超过体积上限 413；其余 404。
 * 载荷原样交给 onHook（cwd → 会话的映射在装配层做，服务层之间不互相引用）。不 import electron。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { HookAgent } from '@shared/ipc'
import { HOOK_AGENTS, HOOK_PATH_PREFIX } from './hookContract'

const DEFAULT_MAX_BODY_BYTES = 64 * 1024
/** 首选端口被占时最多顺延几次 */
const MAX_PORT_ATTEMPTS = 20

export interface HookServerDeps {
  onHook: (agent: HookAgent, payload: Record<string, unknown>) => void
  maxBodyBytes?: number
}

/** 路径 → 来源：只认契约表里的 agent */
function agentOfPath(path: string): HookAgent | null {
  if (!path.startsWith(HOOK_PATH_PREFIX)) return null
  const name = path.slice(HOOK_PATH_PREFIX.length).split('?')[0]
  return HOOK_AGENTS.find((a) => a === name) ?? null
}

export class HookServer {
  private server: Server | null = null
  private port = 0
  private readonly maxBodyBytes: number

  constructor(private readonly deps: HookServerDeps) {
    this.maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  }

  /** 从 preferredPort 起最多试 MAX_PORT_ATTEMPTS 个端口（0 = 随机）；返回实际端口 */
  async start(preferredPort: number): Promise<number> {
    if (this.server) return this.port
    const attempts = preferredPort === 0 ? 1 : MAX_PORT_ATTEMPTS
    let lastError: unknown = null
    for (let i = 0; i < attempts; i += 1) {
      const port = preferredPort === 0 ? 0 : preferredPort + i
      try {
        this.port = await this.listen(port)
        return this.port
      } catch (err) {
        lastError = err
      }
    }
    throw new Error(
      `HookServer 无法监听端口 ${preferredPort} 起的 ${attempts} 个端口：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    )
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res))
      server.once('error', (err) => {
        server.close()
        reject(err)
      })
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error')
        this.server = server
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : port)
      })
    })
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const agent = req.method === 'POST' ? agentOfPath(req.url ?? '') : null
    if (!agent) {
      res.writeHead(404).end()
      req.resume()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let isTooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (isTooLarge) return
      size += chunk.length
      if (size > this.maxBodyBytes) {
        isTooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (isTooLarge) {
        res.writeHead(413).end()
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        res.writeHead(400).end()
        return
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        res.writeHead(400).end()
        return
      }
      res.writeHead(204).end()
      this.deps.onHook(agent, payload as Record<string, unknown>)
    })
    req.on('error', () => res.writeHead(400).end())
  }
}
