import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerIpc, type IpcDeps } from '../../src/main/ipc'
import { SessionStore } from '../../src/main/store/SessionStore'
import type { Session } from '@shared/models'
import { createFakeIpcMain, type FakeIpcMain } from './fakeIpcMain'

describe('IPC 接口层', () => {
  let dir: string
  let ipc: FakeIpcMain
  let deps: IpcDeps

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-ipc-'))
    const store = new SessionStore(dir)
    await store.load()
    ipc = createFakeIpcMain()
    deps = {
      version: '0.1.0',
      store,
      pickDirectory: async () => 'D:\\picked',
      listShells: () => ['cmd.exe', 'powershell.exe'],
    }
    registerIpc(ipc, deps)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('app:get-version 返回装配层注入的应用版本', async () => {
    await expect(ipc.invoke('app:get-version')).resolves.toBe('0.1.0')
  })

  it('session:create / list / update / remove 经接口层落到 SessionStore', async () => {
    const created = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    expect(created).toMatchObject({ name: 'x', cwd: 'D:\\x', shell: 'cmd.exe' })
    await expect(ipc.invoke('session:list')).resolves.toEqual([created])

    const updated = (await ipc.invoke('session:update', created.id, { name: 'n2' })) as Session
    expect(updated.name).toBe('n2')

    await ipc.invoke('session:remove', created.id)
    await expect(ipc.invoke('session:list')).resolves.toEqual([])
  })

  it('非法参数在接口层被拒绝', async () => {
    await expect(ipc.invoke('session:create', { cwd: '' })).rejects.toThrow(/目录/)
    await expect(ipc.invoke('session:create', { cwd: 'D:\\x', shell: 'bash' })).rejects.toThrow(
      /shell/i,
    )
    await expect(ipc.invoke('session:update', 123, {})).rejects.toThrow()
    await expect(ipc.invoke('session:remove', '')).rejects.toThrow()
  })

  it('session:pick-directory 返回系统目录选择框的结果', async () => {
    await expect(ipc.invoke('session:pick-directory')).resolves.toBe('D:\\picked')
  })

  it('app:list-shells 返回本机可用的 shell', async () => {
    await expect(ipc.invoke('app:list-shells')).resolves.toEqual(['cmd.exe', 'powershell.exe'])
  })
})
