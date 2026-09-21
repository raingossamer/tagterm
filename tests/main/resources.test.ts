import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** PNG 的 IHDR：宽高各 4 字节大端，紧跟 8 字节签名与 4 字节长度 + "IHDR" */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file)
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('托盘 / 任务栏角标图标资源', () => {
  const resources = join(process.cwd(), 'resources')

  it('托盘五张图（原 / 黄 / 红 / 蓝 / 绿）都是 32×32，任务栏 overlay 三张（黄 / 蓝 / 绿）是 16×16', () => {
    for (const name of [
      'tray.png',
      'tray-blocked.png',
      'tray-alert.png',
      'tray-done.png',
      'tray-working.png',
    ]) {
      expect(pngSize(join(resources, name))).toEqual({ width: 32, height: 32 })
    }
    for (const name of ['overlay-blocked.png', 'overlay-done.png', 'overlay-working.png']) {
      expect(pngSize(join(resources, name))).toEqual({ width: 16, height: 16 })
    }
  })
})
