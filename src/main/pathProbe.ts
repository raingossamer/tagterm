/**
 * PATH 探测（纯函数，文件存在性判定以参数注入）：
 * - findOnPath：给定名字列表，按 .exe / .cmd / .bat / 无后缀任一命中即视为已安装
 * - detectAvailableShells：按 SHELL_KINDS 顺序检查 shell 可执行文件
 */
import { join } from 'node:path'
import { SHELL_KINDS, type ShellKind } from '@shared/models'

const EXECUTABLE_EXTS = ['', '.exe', '.cmd', '.bat']

function splitPath(pathEnv: string): string[] {
  return pathEnv
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
}

export function findOnPath<T extends string>(
  names: readonly T[],
  pathEnv: string,
  isFile: (fullPath: string) => boolean,
): T[] {
  const dirs = splitPath(pathEnv)
  return names.filter((name) =>
    dirs.some((dir) => EXECUTABLE_EXTS.some((ext) => isFile(join(dir, name + ext)))),
  )
}

export function detectAvailableShells(
  pathEnv: string,
  isFile: (fullPath: string) => boolean,
): ShellKind[] {
  return findOnPath(SHELL_KINDS, pathEnv, isFile)
}
