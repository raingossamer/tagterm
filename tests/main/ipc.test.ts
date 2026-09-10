import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerIpc, type IpcDeps } from '../../src/main/ipc'
import { SessionStore } from '../../src/main/store/SessionStore'
import { PtyManager } from '../../src/main/pty/PtyManager'
import type { PtyExitEvent, PtyOpenResult } from '@shared/ipc'
import type { Session } from '@shared/models'
import { createFakeIpcMain, type FakeIpcMain } from './fakeIpcMain'
import { waitFor } from './helpers'

describe('IPC 接口层', () => {
  let dir: string
  let ipc: FakeIpcMain
  let deps: IpcDeps
  let store: SessionStore
  let pty: PtyManager
  const output: Record<string, string> = {}
  const exits: PtyExitEvent[] = []

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-ipc-'))
    store = new SessionStore(dir)
    await store.load()
    pty = new PtyManager({
      onData: (id, d) => {
        output[id] = (output[id] ?? '') + d
      },
      onExit: (e) => exits.push(e),
    })
    ipc = createFakeIpcMain()
    deps = {
      version: '0.1.0',
      osBuild: 26200,
      store,
      pty,
      pickDirectory: async () => 'D:\\picked',
      listShells: () => ['cmd.exe', 'powershell.exe'],
    }
    registerIpc(ipc, deps)
  })
  afterEach(() => {
    pty.killAll()
    exits.length = 0
    for (const k of Object.keys(output)) delete output[k]
    rmSync(dir, { recursive: true, force: true })
  })

  it('app:get-version / app:get-os-build 返回装配层注入的值', async () => {
    await expect(ipc.invoke('app:get-version')).resolves.toBe('0.1.0')
    await expect(ipc.invoke('app:get-os-build')).resolves.toBe(26200)
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
    await expect(ipc.invoke('pty:open', 'x', { cols: 0, rows: 24 })).rejects.toThrow(/尺寸/)
    await expect(ipc.invoke('pty:resize', 'x', { cols: 80, rows: 1.5 })).rejects.toThrow(/尺寸/)
  })

  it('session:pick-directory 返回系统目录选择框的结果', async () => {
    await expect(ipc.invoke('session:pick-directory')).resolves.toBe('D:\\picked')
  })

  it('app:list-shells 返回本机可用的 shell', async () => {
    await expect(ipc.invoke('app:list-shells')).resolves.toEqual(['cmd.exe', 'powershell.exe'])
  })

  it('pty:open 按会话目录 / shell 起真实终端且幂等；写入 / 是否存活 / kill 经接口层生效', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session

    const first = (await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })) as PtyOpenResult
    expect(first.created).toBe(true)
    expect(first.pid).toBeGreaterThan(0)
    const again = (await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })) as PtyOpenResult
    expect(again).toEqual({ created: false, pid: first.pid })
    await expect(ipc.invoke('pty:is-alive', s.id)).resolves.toBe(true)
    expect(store.get(s.id).lastOpenedAt).toBeDefined()

    ipc.send('pty:write', s.id, 'echo via-ipc\r')
    await waitFor(() => (output[s.id] ?? '').includes('via-ipc'))
    await ipc.invoke('pty:resize', s.id, { cols: 100, rows: 30 })

    await ipc.invoke('pty:kill', s.id)
    await waitFor(() => exits.some((e) => e.sessionId === s.id))
    await expect(ipc.invoke('pty:is-alive', s.id)).resolves.toBe(false)
  })

  it('pty:open 不存在的会话报错', async () => {
    await expect(ipc.invoke('pty:open', 'missing', { cols: 80, rows: 24 })).rejects.toThrow(
      /会话不存在/,
    )
  })

  it('session:remove 同时结束其 pty', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session
    await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })

    await ipc.invoke('session:remove', s.id)
    await waitFor(() => exits.some((e) => e.sessionId === s.id))
    expect(pty.has(s.id)).toBe(false)
    await expect(ipc.invoke('session:list')).resolves.toEqual([])
  })
})
