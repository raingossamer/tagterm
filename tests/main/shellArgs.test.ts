import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildSpawnSpec, resolveShellFile } from '../../src/main/pty/shellArgs'

const SYS32 = 'C:\\Windows\\System32'
const PS_DIR = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'

describe('resolveShellFile', () => {
  const env = { PATH: ['D:\\tools', SYS32].join(';'), SystemRoot: 'C:\\Windows' }

  it('PATH 上命中即返回该绝对路径（按目录顺序取第一个）', () => {
    const present = new Set([join('D:\\tools', 'cmd.exe'), join(SYS32, 'cmd.exe')])
    expect(resolveShellFile('cmd.exe', env, (p) => present.has(p))).toBe('D:\\tools\\cmd.exe')
  })

  it('PATH 没命中时退到系统固定位置：cmd 在 System32，powershell 在 WindowsPowerShell\\v1.0', () => {
    const present = new Set([join(SYS32, 'cmd.exe'), join(PS_DIR, 'powershell.exe')])
    const noPath = { SystemRoot: 'C:\\Windows' }
    const isFile = (p: string): boolean => present.has(p)
    expect(resolveShellFile('cmd.exe', noPath, isFile)).toBe(join(SYS32, 'cmd.exe'))
    expect(resolveShellFile('powershell.exe', noPath, isFile)).toBe(join(PS_DIR, 'powershell.exe'))
  })

  it('SystemRoot 缺失时用 windir，再缺失用 C:\\Windows', () => {
    const present = new Set(['D:\\Win\\System32\\cmd.exe', 'C:\\Windows\\System32\\cmd.exe'])
    const isFile = (p: string): boolean => present.has(p)
    expect(resolveShellFile('cmd.exe', { windir: 'D:\\Win' }, isFile)).toBe(
      'D:\\Win\\System32\\cmd.exe',
    )
    expect(resolveShellFile('cmd.exe', {}, isFile)).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('pwsh 不随系统装：PATH 没命中就原名兜底；cmd 固定位置也不存在时同样原名兜底', () => {
    expect(resolveShellFile('pwsh.exe', env, () => false)).toBe('pwsh.exe')
    expect(resolveShellFile('cmd.exe', env, () => false)).toBe('cmd.exe')
  })

  it('PATH 键名写作 Path 也认（普通对象不像 process.env 那样不分大小写）', () => {
    const present = new Set([join(SYS32, 'cmd.exe')])
    expect(resolveShellFile('cmd.exe', { Path: SYS32 }, (p) => present.has(p))).toBe(
      join(SYS32, 'cmd.exe'),
    )
  })
})

describe('buildSpawnSpec', () => {
  const env = { PATH: SYS32, USERPROFILE: 'C:\\Users\\k' }
  /** System32 下的文件都当存在 */
  const isFile = (p: string): boolean => p.startsWith(SYS32 + '\\')

  it('cmd.exe：file 是绝对路径，以 /k chcp 65001 >nul 启动，env 追加 LANG=zh_CN.UTF-8', () => {
    const spec = buildSpawnSpec('cmd.exe', 'D:\\proj', env, isFile)

    expect(spec.file).toBe(join(SYS32, 'cmd.exe'))
    expect(spec.commandLine).toBe('/k chcp 65001 >nul')
    expect(spec.env).toMatchObject({ ...env, LANG: 'zh_CN.UTF-8' })
  })

  it('powershell.exe / pwsh.exe：file 是绝对路径，设置 UTF-8 输出编码并保持会话', () => {
    for (const shell of ['powershell.exe', 'pwsh.exe'] as const) {
      const spec = buildSpawnSpec(shell, 'D:\\proj', env, isFile)
      expect(spec.file).toBe(join(SYS32, shell))
      expect(spec.commandLine).toContain('-NoLogo -NoExit -Command')
      expect(spec.commandLine).toContain('[Console]::OutputEncoding=[Text.Encoding]::UTF8')
      expect(spec.commandLine).toContain('chcp 65001')
      expect(spec.env.LANG).toBe('zh_CN.UTF-8')
    }
  })

  it('env 中的 undefined 值被剔除（node-pty 要求 Record<string, string>）', () => {
    const spec = buildSpawnSpec('cmd.exe', 'D:\\proj', { A: '1', B: undefined }, () => false)
    expect(spec.env).toEqual({ A: '1', LANG: 'zh_CN.UTF-8' })
  })
})
