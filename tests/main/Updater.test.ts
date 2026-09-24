import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { Updater } from '../../src/main/updater/Updater'
import { FakeAutoUpdater } from './fakeAutoUpdater'
import type { UpdateStatus } from '@shared/models'

describe('Updater', () => {
  let auto: FakeAutoUpdater
  let loads: number
  let statuses: UpdateStatus[]
  let beforeInstall: Mock<() => void>
  let updater: Updater

  beforeEach(() => {
    auto = new FakeAutoUpdater()
    loads = 0
    statuses = []
    beforeInstall = vi.fn(() => {
      auto.order.push('before')
    })
    updater = new Updater({
      loadAutoUpdater: async () => {
        loads += 1
        return auto
      },
      currentVersion: '0.1.0',
      onStatus: (s) => statuses.push(s),
      beforeInstall,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('构造不加载 electron-updater（启动不为它花时间）：状态 idle、autoDownload 未动；首次 check 才加载一次并关闭自动下载，再次 check 不再加载', async () => {
    expect(loads).toBe(0)
    expect(auto.autoDownload).toBe(true)
    expect(updater.status()).toEqual({ state: 'idle' })

    await updater.check()
    expect(loads).toBe(1)
    expect(auto.autoDownload).toBe(false)
    await updater.check()
    expect(loads).toBe(1)
    expect(auto.checkCalls).toBe(2)
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
    await updater.download() // 第一次用到就是 download：同样触发加载
    expect(loads).toBe(1)
    expect(auto.downloadCalls).toBe(1)
    auto.emit('update-available', { version: '0.2.0' })

    auto.emit('download-progress', { percent: 42.42 })
    expect(updater.status()).toEqual({ state: 'downloading', version: '0.2.0', percent: 42 })
    auto.emit('update-downloaded', { version: '0.2.0' })
    expect(updater.status()).toEqual({ state: 'downloaded', version: '0.2.0' })

    await updater.install()
    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(auto.order).toEqual(['before', 'install'])
  })

  it('加载 electron-updater 失败：转成 error 状态、不抛，也不结束终端；下次再用时重新尝试加载', async () => {
    let shouldFail = true
    updater = new Updater({
      loadAutoUpdater: async () => {
        loads += 1
        if (shouldFail) throw new Error('模块坏了')
        return auto
      },
      currentVersion: '0.1.0',
      onStatus: (s) => statuses.push(s),
      beforeInstall,
    })
    await updater.install()
    expect(updater.status()).toEqual({ state: 'error', message: '模块坏了' })
    expect(beforeInstall).not.toHaveBeenCalled()
    expect(auto.installCalls).toBe(0)

    shouldFail = false
    await updater.check()
    expect(loads).toBe(2)
    expect(auto.checkCalls).toBe(1)
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

  it('scheduleAutoCheck 延迟后自动检查一次（到点才加载）', async () => {
    vi.useFakeTimers()
    updater.scheduleAutoCheck(10_000)
    expect(auto.checkCalls).toBe(0)
    expect(loads).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(auto.checkCalls).toBe(1)
    expect(loads).toBe(1)
  })
})
