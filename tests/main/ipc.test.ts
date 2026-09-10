import { describe, expect, it } from 'vitest'
import { registerIpc } from '../../src/main/ipc'
import { createFakeIpcMain } from './fakeIpcMain'

describe('IPC 接口层', () => {
  it('app:get-version 返回装配层注入的应用版本', async () => {
    const ipc = createFakeIpcMain()
    registerIpc(ipc, { version: '0.1.0' })

    await expect(ipc.invoke('app:get-version')).resolves.toBe('0.1.0')
  })
})
