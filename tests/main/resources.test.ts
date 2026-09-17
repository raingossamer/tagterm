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

  it('tray.png 与 tray-blocked.png 都是 32×32，overlay-blocked.png 是 16×16', () => {
    expect(pngSize(join(resources, 'tray.png'))).toEqual({ width: 32, height: 32 })
    expect(pngSize(join(resources, 'tray-blocked.png'))).toEqual({ width: 32, height: 32 })
    expect(pngSize(join(resources, 'overlay-blocked.png'))).toEqual({ width: 16, height: 16 })
  })
})
