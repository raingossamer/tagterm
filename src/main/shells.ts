/**
 * shell 可用性探测：按 SHELL_KINDS 顺序检查 PATH 各目录下是否存在对应可执行文件。
 * 纯函数，文件存在性判定以参数注入，便于测试。
 */
import { join } from 'node:path'
import { SHELL_KINDS, type ShellKind } from '@shared/models'

export function detectAvailableShells(
  pathEnv: string,
  isFile: (fullPath: string) => boolean,
): ShellKind[] {
  const dirs = pathEnv
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
  return SHELL_KINDS.filter((shell) => dirs.some((dir) => isFile(join(dir, shell))))
}
