/**
 * @vscode/windows-process-tree（N-API 预编译，实测一次 14–18 ms）的最小适配：某 pid 的全部后代进程（不含它自己），带命令行。
 * 只有这里 import 原生模块；ProcessTreeProbe 以 listSubtree 谓词注入，测试传假子树。不 import electron。
 */
import { getProcessList, ProcessDataFlag } from '@vscode/windows-process-tree'
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
