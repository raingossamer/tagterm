import { describe, expect, it } from 'vitest'
import { describeUpdateStatus } from '../../src/renderer/src/composables/updateStatus'

describe('describeUpdateStatus', () => {
  it('把更新状态转成设置弹窗文案', () => {
    expect(describeUpdateStatus({ state: 'idle' })).toBe('')
    expect(describeUpdateStatus({ state: 'checking' })).toBe('正在检查…')
    expect(describeUpdateStatus({ state: 'none', version: '0.1.0' })).toBe('已是最新版本 v0.1.0')
    expect(describeUpdateStatus({ state: 'available', version: '0.2.0' })).toBe('发现新版本 v0.2.0')
    expect(describeUpdateStatus({ state: 'downloading', version: '0.2.0', percent: 42 })).toBe(
      '正在下载 v0.2.0：42%',
    )
    expect(describeUpdateStatus({ state: 'downloaded', version: '0.2.0' })).toBe(
      'v0.2.0 已下载，安装后自动重启',
    )
    expect(describeUpdateStatus({ state: 'error', message: 'ECONNREFUSED' })).toBe(
      '检查更新失败：ECONNREFUSED',
    )
  })
})
