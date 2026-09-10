/**
 * 按 shell 生成 node-pty 的 spawn 参数（纯函数）。
 * Windows 上 node-pty 接受字符串形式的 args 作为原始命令行，避免它给含空格的参数加引号后
 * 让 cmd 把 "chcp 65001 >nul" 当成一个命令名（> 是 cmd 特殊字符，引号不会被剥掉）。
 */
import type { ShellKind } from '@shared/models'

export interface SpawnSpec {
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

export function buildSpawnSpec(shell: ShellKind, _cwd: string, env: NodeJS.ProcessEnv): SpawnSpec {
  const cleanEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) cleanEnv[key] = value
  }
  cleanEnv['LANG'] = UTF8_LANG
  return { file: shell, commandLine: COMMAND_LINES[shell], env: cleanEnv }
}
