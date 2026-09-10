import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { Updater } from '../../src/main/updater/Updater'
import { FakeAutoUpdater } from './fakeAutoUpdater'
import type { UpdateStatus } from '@shared/models'

describe('Updater', () => {
  let auto: FakeAutoUpdater
  let statuses: UpdateStatus[]
  let beforeInstall: Mock<() => void>
  let updater: Updater

  beforeEach(() => {
    auto = new FakeAutoUpdater()
    statuses = []
    beforeInstall = vi.fn(() => {
      auto.order.push('before')
    })
    updater = new Updater({
      autoUpdater: auto,
      currentVersion: '0.1.0',
      onStatus: (s) => statuses.push(s),
      beforeInstall,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('构造后关闭自动下载；初始状态 idle', () => {
    expect(auto.autoDownload).toBe(false)
    expect(updater.status()).toEqual({ state: 'idle' })
  })

  it('check：发出 checking，随后按 electron-updater 事件转成 available / none / error', async () => {
    await updater.check()
    expect(auto.checkCalls).toBe(1)
    expect(statuses).toEqual([{ state: 'checking' }])

    auto.emit('update-available', { version: '0.2.0' })
    expect(updater.status()).toEqual({ state: 'available', version: '0.2.0' })

    auto.emit('update-not-available', { version: '0.1.0' })
    expect(updater.status()).toEqual({ state: 'none', version: '0.1.0' })

    auto.emit('error', new Error('net::ERR_CONNECTION_REFUSED'))
    expect(updater.status()).toEqual({ state: 'error', message: 'net::ERR_CONNECTION_REFUSED' })
    expect(statuses).toHaveLength(4)
  })

  it('download：进度事件转成 downloading {percent}，完成转成 downloaded；install 先回调再 quitAndInstall', async () => {
    auto.emit('update-available', { version: '0.2.0' })
    await updater.download()
    expect(auto.downloadCalls).toBe(1)

    auto.emit('download-progress', { percent: 42.42 })
    expect(updater.status()).toEqual({ state: 'downloading', version: '0.2.0', percent: 42 })
    auto.emit('update-downloaded', { version: '0.2.0' })
    expect(updater.status()).toEqual({ state: 'downloaded', version: '0.2.0' })

    updater.install()
    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(auto.order).toEqual(['before', 'install'])
  })

  it('checkForUpdates 本身抛错（如未打包）也转成 error 状态，不向上抛', async () => {
    auto.checkForUpdates = async () => {
      throw new Error('应用未打包')
    }
    await updater.check()
    expect(updater.status()).toEqual({ state: 'error', message: '应用未打包' })
  })

  it('checkForUpdates 返回 null（未打包）且无事件时转成 error，不会停在 checking', async () => {
    auto.checkResult = null
    await updater.check()
    expect(updater.status()).toEqual({ state: 'error', message: '未打包的开发版本不支持检查更新' })
  })

  it('scheduleAutoCheck 延迟后自动检查一次', async () => {
    vi.useFakeTimers()
    updater.scheduleAutoCheck(10_000)
    expect(auto.checkCalls).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(auto.checkCalls).toBe(1)
  })
})
