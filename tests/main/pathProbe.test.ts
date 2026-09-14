import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { detectAvailableShells, findOnPath, resolveOnPath } from '../../src/main/pathProbe'

describe('resolveOnPath', () => {
  const sys32 = 'C:\\Windows\\System32'
  const npmGlobal = 'E:\\NodeVue\\node_global'
  const pathEnv = [npmGlobal, ' C:\\tools ', sys32, ''].join(';')

  it('返回第一个命中目录里的绝对路径：目录顺序优先于后缀顺序（无后缀 / .exe / .cmd / .bat）', () => {
    const present = new Set([
      join(npmGlobal, 'claude.cmd'),
      join(sys32, 'claude.exe'),
      join(sys32, 'cmd.exe'),
    ])
    const isFile = (p: string): boolean => present.has(p)
    expect(resolveOnPath('claude', pathEnv, isFile)).toBe(join(npmGlobal, 'claude.cmd'))
    expect(resolveOnPath('cmd.exe', pathEnv, isFile)).toBe(join(sys32, 'cmd.exe'))
  })

  it('目录项两侧空白与空项被忽略；没命中或 PATH 为空返回 null', () => {
    const present = new Set([join('C:\\tools', 'x.exe')])
    expect(resolveOnPath('x', pathEnv, (p) => present.has(p))).toBe(join('C:\\tools', 'x.exe'))
    expect(resolveOnPath('nope', pathEnv, () => false)).toBeNull()
    expect(resolveOnPath('x', '', () => true)).toBeNull()
  })
})

describe('findOnPath', () => {
  const sys32 = 'C:\\Windows\\System32'
  const npmGlobal = 'E:\\NodeVue\\node_global'
  const pathEnv = [npmGlobal, 'C:\\tools', sys32].join(';')

  it('按给定顺序返回 PATH 上存在的名字，可执行后缀 .exe / .cmd / .bat 任一命中即可', () => {
    const present = new Set([
      join(npmGlobal, 'claude.cmd'),
      join(npmGlobal, 'pi.cmd'),
      join(sys32, 'cmd.exe'),
    ])

    const found = findOnPath(['claude', 'gemini', 'codex', 'pi'], pathEnv, (p) => present.has(p))
    expect(found).toEqual(['claude', 'pi'])
  })

  it('PATH 为空时返回空数组', () => {
    expect(findOnPath(['claude'], '', () => true)).toEqual([])
  })
})

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
})
