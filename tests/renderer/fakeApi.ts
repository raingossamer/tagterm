import { vi } from 'vitest'
import type { TagTermApi } from '@shared/api'

/**
 * 渲染进程测试用的 window.tagterm 假实现：SDK 风格，每个函数独立 mock。
 * 传入 overrides 覆盖需要的函数，其余为 vi.fn()。
 */
export function installFakeApi(overrides: Partial<TagTermApi> = {}): TagTermApi {
  const api: TagTermApi = {
    app: {
      getVersion: vi.fn(async () => '0.0.0-test'),
      ...overrides.app,
    },
  }
  Object.defineProperty(window, 'tagterm', { value: api, configurable: true, writable: true })
  return api
}
