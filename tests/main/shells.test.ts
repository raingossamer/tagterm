import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { detectAvailableShells } from '../../src/main/shells'

describe('detectAvailableShells', () => {
  it('只返回 PATH 上存在可执行文件的 shell，顺序与 SHELL_KINDS 一致', () => {
    const sys32 = 'C:\\Windows\\System32'
    const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'
    const present = new Set([join(sys32, 'cmd.exe'), join(ps, 'powershell.exe')])
    const pathEnv = [ps, 'C:\\tools', sys32].join(';')

    expect(detectAvailableShells(pathEnv, (p) => present.has(p))).toEqual([
      'cmd.exe',
      'powershell.exe',
    ])
  })

  it('PATH 为空时返回空数组', () => {
    expect(detectAvailableShells('', () => true)).toEqual([])
  })
})
