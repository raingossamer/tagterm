/**
 * @vscode/windows-process-tree（N-API 预编译，实测一次 14–18 ms）的最小适配：某 pid 的全部后代进程（不含它自己）、
 * 以及全机进程表（hook 归属用，本机 360 个进程实测 12 ms），都带命令行。
 * 只有这里 import 原生模块；ProcessTreeProbe 以 listSubtree、AgentSubsystem 以 listProcesses 注入，测试传假件。不 import electron。
 */
import { getAllProcesses, getProcessList, ProcessDataFlag } from '@vscode/windows-process-tree'
import type { ProcessNode } from './processMatch'

export function listSubtree(rootPid: number): Promise<ProcessNode[]> {
  return new Promise((resolve, reject) => {
    try {
      getProcessList(
        rootPid,
        (list) => {
          resolve(
            (list ?? [])
              .filter((p) => p.pid !== rootPid)
              .map((p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, commandLine: p.commandLine })),
          )
        },
        ProcessDataFlag.CommandLine,
      )
    } catch (err) {
      reject(err)
    }
  })
}

export function listProcesses(): Promise<ProcessNode[]> {
  return new Promise((resolve, reject) => {
    try {
      getAllProcesses((list) => {
        resolve(
          (list ?? []).map((p) => ({
            pid: p.pid,
            ppid: p.ppid,
            name: p.name,
            commandLine: p.commandLine,
          })),
        )
      }, ProcessDataFlag.CommandLine)
    } catch (err) {
      reject(err)
    }
  })
}
