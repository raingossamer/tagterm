/**
 * 服务层：进程树一次性查询 —— 判断某个 pid（pty 的 shell 进程）当前有没有子进程。
 * 空闲的 cmd / PowerShell 停在提示符时没有子进程；跑着 claude / codex / pi 等工具时有。
 * 用 PowerShell 查 Win32_Process（M3 ProcessTreeProbe 的种子）；exec 以参数注入，测试传假实现。不 import electron。
 */
import { execFile } from 'node:child_process'

/** 执行外部命令并返回 stdout */
export type ExecFn = (file: string, args: string[]) => Promise<string>

const QUERY_TIMEOUT_MS = 10_000

function execPowerShell(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: QUERY_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/** 子进程 pid 列表（直接子进程，不递归） */
export async function listChildPids(pid: number, exec: ExecFn = execPowerShell): Promise<number[]> {
  const command = `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object -ExpandProperty ProcessId`
  let stdout: string
  try {
    stdout = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
  } catch (err) {
    throw new Error(`无法判定终端是否空闲：${err instanceof Error ? err.message : String(err)}`)
  }
  return stdout
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0)
}

export async function hasChildProcesses(pid: number, exec?: ExecFn): Promise<boolean> {
  return (await listChildPids(pid, exec)).length > 0
}
