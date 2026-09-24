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
  /** 首选端口被占时最多试几个（缺省 MAX_PORT_ATTEMPTS；测试用 1 构造「全部失败」） */
  maxPortAttempts?: number
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 监听失败是不是「整段都起不来」：EACCES 说明端口落在 Windows 的动态保留端口段（Hyper-V / WSL 按 100 个一段划走），
 * 同段相邻端口一样起不来，逐个试 20 次只是白等（本机实测每次 5–7 ms，整段 100 多毫秒）；被占（EADDRINUSE）才值得顺延一个
 */
export function isSegmentBlocked(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'EACCES'
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
  private readonly maxPortAttempts: number

  constructor(private readonly deps: HookServerDeps) {
    this.maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    this.maxPortAttempts = deps.maxPortAttempts ?? MAX_PORT_ATTEMPTS
  }

  /**
   * 从 preferredPort 起最多试 maxPortAttempts 个端口（被占顺延一个；EACCES 说明整段落进 Windows 的保留端口段，
   * 立即换段不再逐个试）；整段都起不来再依次换 fallbacks 里的起点，换段时记一行日志。0 = 随机端口，只试一次。
   * 返回实际端口，全部失败抛错
   */
  async start(preferredPort: number, fallbacks: readonly number[] = []): Promise<number> {
    if (this.server) return this.port
    const bases = [preferredPort, ...fallbacks]
    let lastError: unknown = null
    for (const base of bases) {
      if (lastError !== null)
        console.warn(
          `[agent] hooks 端点换一段端口再试（${base === 0 ? '随机端口' : `${base} 起`}）：${messageOf(lastError)}`,
        )
      const attempts = base === 0 ? 1 : this.maxPortAttempts
      for (let i = 0; i < attempts; i += 1) {
        try {
          this.port = await this.listen(base === 0 ? 0 : base + i)
          return this.port
        } catch (err) {
          lastError = err
          if (isSegmentBlocked(err)) break
        }
      }
    }
    throw new Error(`HookServer 无法监听端口（起点 ${bases.join('、')}）：${messageOf(lastError)}`)
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
