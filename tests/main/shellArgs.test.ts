import { describe, expect, it } from 'vitest'
import { buildSpawnSpec } from '../../src/main/pty/shellArgs'

describe('buildSpawnSpec', () => {
  const env = { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\k' }

  it('cmd.exe：以 /k chcp 65001 >nul 启动，env 追加 LANG=zh_CN.UTF-8', () => {
    const spec = buildSpawnSpec('cmd.exe', 'D:\\proj', env)

    expect(spec.file).toBe('cmd.exe')
    expect(spec.commandLine).toBe('/k chcp 65001 >nul')
    expect(spec.env).toMatchObject({ ...env, LANG: 'zh_CN.UTF-8' })
  })

  it('powershell.exe / pwsh.exe：设置 UTF-8 输出编码并保持会话', () => {
    for (const shell of ['powershell.exe', 'pwsh.exe'] as const) {
      const spec = buildSpawnSpec(shell, 'D:\\proj', env)
      expect(spec.file).toBe(shell)
      expect(spec.commandLine).toContain('-NoLogo -NoExit -Command')
      expect(spec.commandLine).toContain('[Console]::OutputEncoding=[Text.Encoding]::UTF8')
      expect(spec.commandLine).toContain('chcp 65001')
      expect(spec.env.LANG).toBe('zh_CN.UTF-8')
    }
  })

  it('env 中的 undefined 值被剔除（node-pty 要求 Record<string, string>）', () => {
    const spec = buildSpawnSpec('cmd.exe', 'D:\\proj', { A: '1', B: undefined })
    expect(spec.env).toEqual({ A: '1', LANG: 'zh_CN.UTF-8' })
  })
})
