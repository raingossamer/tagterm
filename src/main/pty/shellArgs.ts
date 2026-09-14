/**
 * 按 shell 生成 node-pty 的 spawn 参数（纯函数，文件存在性判定以参数注入）。
 * Windows 上 node-pty 接受字符串形式的 args 作为原始命令行，避免它给含空格的参数加引号后
 * 让 cmd 把 "chcp 65001 >nul" 当成一个命令名（> 是 cmd 特殊字符，引号不会被剥掉）。
 *
 * 可执行文件必须给绝对路径：node-pty 1.1.0 对相对名（如 cmd.exe）会自己拿主进程的 Path 逐段找，
 * 而它的 path_util.cc get_shell_path 有个缺陷 —— 主进程当前工作目录里恰好有同名文件时返回空串，
 * 于是抛「File not found: 」（冒号后是空的）。开机自启由注册表 Run 项拉起时，工作目录正是 System32，
 * cmd.exe 就在那里，每次自启后打开会话必然撞上（用户 2026-09-14 反馈）；手动启动的工作目录是安装目录，撞不上。
 */
import { join } from 'node:path'
import type { ShellKind } from '@shared/models'
import { resolveOnPath } from '../pathProbe'

export interface SpawnSpec {
  /** 可执行文件绝对路径（见 resolveShellFile；三级兜底都落空时才是原名） */
  file: string
  commandLine: string
  env: Record<string, string>
}

const UTF8_LANG = 'zh_CN.UTF-8'

const POWERSHELL_INIT =
  '-NoLogo -NoExit -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 | Out-Null"'

const COMMAND_LINES: Record<ShellKind, string> = {
  'cmd.exe': '/k chcp 65001 >nul',
  'powershell.exe': POWERSHELL_INIT,
  'pwsh.exe': POWERSHELL_INIT,
}

/** PATH 没命中时的系统固定位置（相对 SystemRoot 的各段）；pwsh 不随系统装，没有固定位置 */
const SYSTEM_LOCATIONS: Record<ShellKind, readonly string[] | null> = {
  'cmd.exe': ['System32', 'cmd.exe'],
  'powershell.exe': ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
  'pwsh.exe': null,
}

/** process.env 在 Windows 上键名不分大小写，但测试传的普通对象分：PATH / Path 两种写法都认 */
function pathOf(env: NodeJS.ProcessEnv): string {
  return env['PATH'] ?? env['Path'] ?? ''
}

/**
 * shell 名 → 绝对路径：PATH 上第一个命中 → 系统固定位置（存在才用）→ 原名兜底
 * （兜底时 node-pty 会用它自己的逻辑再找一次并报错，不比以前更糟）
 */
export function resolveShellFile(
  shell: ShellKind,
  env: NodeJS.ProcessEnv,
  isFile: (fullPath: string) => boolean,
): string {
  const onPath = resolveOnPath(shell, pathOf(env), isFile)
  if (onPath) return onPath
  const location = SYSTEM_LOCATIONS[shell]
  if (location) {
    const systemRoot = env['SystemRoot'] ?? env['windir'] ?? 'C:\\Windows'
    const fixed = join(systemRoot, ...location)
    if (isFile(fixed)) return fixed
  }
  return shell
}

export function buildSpawnSpec(
  shell: ShellKind,
  _cwd: string,
  env: NodeJS.ProcessEnv,
  isFile: (fullPath: string) => boolean,
): SpawnSpec {
  const cleanEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) cleanEnv[key] = value
  }
  cleanEnv['LANG'] = UTF8_LANG
  return {
    file: resolveShellFile(shell, env, isFile),
    commandLine: COMMAND_LINES[shell],
    env: cleanEnv,
  }
}
