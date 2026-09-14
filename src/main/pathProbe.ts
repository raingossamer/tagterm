/**
 * PATH 探测（纯函数，文件存在性判定以参数注入）：
 * - resolveOnPath：给定名字，返回 PATH 上第一个命中的可执行文件绝对路径（按 无后缀 / .exe / .cmd / .bat 试）
 * - findOnPath：给定名字列表，命中即视为已安装
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

/** PATH 上第一个命中的绝对路径：按目录顺序、每个目录内按后缀顺序试；找不到返回 null */
export function resolveOnPath(
  name: string,
  pathEnv: string,
  isFile: (fullPath: string) => boolean,
): string | null {
  for (const dir of splitPath(pathEnv)) {
    for (const ext of EXECUTABLE_EXTS) {
      const candidate = join(dir, name + ext)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

export function findOnPath<T extends string>(
  names: readonly T[],
  pathEnv: string,
  isFile: (fullPath: string) => boolean,
): T[] {
  return names.filter((name) => resolveOnPath(name, pathEnv, isFile) !== null)
}

export function detectAvailableShells(
  pathEnv: string,
  isFile: (fullPath: string) => boolean,
): ShellKind[] {
  return findOnPath(SHELL_KINDS, pathEnv, isFile)
}
