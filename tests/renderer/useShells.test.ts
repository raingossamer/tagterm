import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useShells } from '../../src/renderer/src/composables/useShells'
import { installFakeApi } from './fakeApi'

describe('useShells', () => {
  it('加载本机可用 shell；当前值不在列表里时切到第一项', async () => {
    installFakeApi({ app: { listShells: async () => ['powershell.exe', 'pwsh.exe'] } })
    const { shell, shells } = useShells('cmd.exe')
    expect(shells.value).toEqual(['cmd.exe'])
    await flushPromises()
    expect(shells.value).toEqual(['powershell.exe', 'pwsh.exe'])
    expect(shell.value).toBe('powershell.exe')
  })

  it('当前值在列表里则保留；空列表回落为只含缺省值', async () => {
    installFakeApi({ app: { listShells: async () => ['cmd.exe', 'powershell.exe'] } })
    const kept = useShells('powershell.exe')
    await flushPromises()
    expect(kept.shell.value).toBe('powershell.exe')

    installFakeApi({ app: { listShells: async () => [] } })
    const fallback = useShells('cmd.exe')
    await flushPromises()
    expect(fallback.shells.value).toEqual(['cmd.exe'])
    expect(fallback.shell.value).toBe('cmd.exe')
  })

  it('探测失败时回调错误文案，列表保持缺省', async () => {
    installFakeApi({
      app: {
        listShells: async () => {
          throw new Error('探测失败')
        },
      },
    })
    const onError = vi.fn()
    const { shells } = useShells('cmd.exe', onError)
    await flushPromises()
    expect(onError).toHaveBeenCalledWith('探测失败')
    expect(shells.value).toEqual(['cmd.exe'])
  })
})
