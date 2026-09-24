/**
 * 假 ConPTY（PtyManager 的 spawnPty 测试替身）：不起真实进程。
 * spawn 分配 pid 并记下参数；write / resize / kill 只记录；同一句柄第二次 kill 即抛 ——
 * 真 ConPTY 此时会原生崩溃、整个进程一起没，这里让测试当场失败。
 * 退出与输出都由测试送达：exit(pid, code) / emit(pid, data)。
 * 传入 log 时 kill 记成 `kill:<pid>`，与广播、pty 退出排进同一条有序日志。
 * spawn 参数里的 env **不记录**（只留追加的 LANG）：断言失败时 diff 会把本机全部环境变量（可能含密钥）打进输出。
 */
import type { IDisposable, IWindowsPtyForkOptions } from 'node-pty'
import type { PtyProcess } from '../../src/main/pty/PtyManager'

export interface FakeSpawn {
  pid: number
  file: string
  commandLine: string
  options: Omit<IWindowsPtyForkOptions, 'env'>
  /** env 里的 LANG（PtyManager 追加的 UTF-8） */
  lang: string | undefined
}

interface ExitInfo {
  exitCode: number
  signal?: number
}

interface FakeProcess {
  dataListeners: Set<(data: string) => void>
  exitListeners: Set<(e: ExitInfo) => void>
  isKilled: boolean
  hasExited: boolean
}

export class FakeConpty {
  readonly spawns: FakeSpawn[] = []
  readonly writes: Array<[pid: number, data: string]> = []
  readonly resizes: Array<[pid: number, cols: number, rows: number]> = []
  /** kill 过的 pid，按调用顺序 */
  readonly kills: number[] = []
  private nextPid = 4000
  private readonly processes = new Map<number, FakeProcess>()

  constructor(private readonly log?: string[]) {}

  /** 传给 PtyManagerDeps.spawnPty */
  readonly spawn = (
    file: string,
    commandLine: string,
    { env, ...options }: IWindowsPtyForkOptions,
  ): PtyProcess => {
    const pid = this.nextPid++
    const proc: FakeProcess = {
      dataListeners: new Set(),
      exitListeners: new Set(),
      isKilled: false,
      hasExited: false,
    }
    this.processes.set(pid, proc)
    this.spawns.push({ pid, file, commandLine, options, lang: env?.['LANG'] })
    return {
      pid,
      onData: (listener) => subscribe(proc.dataListeners, listener),
      onExit: (listener) => subscribe(proc.exitListeners, listener),
      write: (data) => {
        this.writes.push([pid, String(data)])
      },
      resize: (cols, rows) => {
        this.resizes.push([pid, cols, rows])
      },
      kill: () => {
        if (proc.isKilled)
          throw new Error(`假 ConPTY：pid ${pid} 被第二次 kill（真 ConPTY 会原生崩溃）`)
        proc.isKilled = true
        this.kills.push(pid)
        this.log?.push(`kill:${pid}`)
      },
    }
  }

  /** 送达该进程的退出（每个进程只能退出一次） */
  exit(pid: number, exitCode = 0): void {
    const proc = this.processOf(pid)
    if (proc.hasExited) throw new Error(`假 ConPTY：pid ${pid} 已经退出过`)
    proc.hasExited = true
    for (const listener of [...proc.exitListeners]) listener({ exitCode })
  }

  /** 送一段输出 */
  emit(pid: number, data: string): void {
    for (const listener of [...this.processOf(pid).dataListeners]) listener(data)
  }

  private processOf(pid: number): FakeProcess {
    const proc = this.processes.get(pid)
    if (!proc) throw new Error(`假 ConPTY：没有 pid ${pid}`)
    return proc
  }
}

function subscribe<T>(listeners: Set<(e: T) => void>, listener: (e: T) => void): IDisposable {
  listeners.add(listener)
  return { dispose: () => listeners.delete(listener) }
}
