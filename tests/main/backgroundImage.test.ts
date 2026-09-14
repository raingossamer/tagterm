import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  readImageAsDataUrl,
} from '../../src/main/store/backgroundImage'

// 1×1 PNG 的字节（测试不依赖真实图片资源）
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('readImageAsDataUrl', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-bg-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('读取图片文件并按扩展名生成 data: URL', async () => {
    const file = join(dir, 'wall.PNG')
    writeFileSync(file, PNG_BYTES)

    const url = await readImageAsDataUrl(file)
    expect(url).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`)
  })

  it('jpg / jpeg / webp / gif / bmp 映射到对应 MIME；其他扩展名拒绝', async () => {
    for (const [ext, mime] of [
      ['jpg', 'image/jpeg'],
      ['jpeg', 'image/jpeg'],
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
      ['bmp', 'image/bmp'],
    ]) {
      const file = join(dir, `a.${ext}`)
      writeFileSync(file, PNG_BYTES)
      expect(await readImageAsDataUrl(file)).toMatch(new RegExp(`^data:${mime};base64,`))
    }
    writeFileSync(join(dir, 'a.txt'), 'x')
    await expect(readImageAsDataUrl(join(dir, 'a.txt'))).rejects.toThrow(/不支持的图片格式/)
  })

  it('文件不存在时返回 null（背景回退纯色，不报错）', async () => {
    await expect(readImageAsDataUrl(join(dir, 'missing.png'))).resolves.toBeNull()
  })

  it('注入的缩图回调返回结果时用它的字节与 MIME；返回 null 表示无需缩放，原样输出', async () => {
    const file = join(dir, 'huge.jpg')
    writeFileSync(file, PNG_BYTES)
    const calls: Array<{ bytes: number; maxEdge: number }> = []
    const shrunk = Buffer.from('shrunk')

    const url = await readImageAsDataUrl(file, (bytes, maxEdge) => {
      calls.push({ bytes: bytes.length, maxEdge })
      return { bytes: shrunk, mime: 'image/png' }
    })
    expect(calls).toEqual([{ bytes: PNG_BYTES.length, maxEdge: MAX_IMAGE_EDGE }])
    expect(url).toBe(`data:image/png;base64,${shrunk.toString('base64')}`)

    // 回调说「不用缩」→ 原文件字节与扩展名对应的 MIME
    expect(await readImageAsDataUrl(file, () => null)).toBe(
      `data:image/jpeg;base64,${PNG_BYTES.toString('base64')}`,
    )
  })

  it('文件超过体积上限时抛错，提示换一张（避免超大图把 IPC 与内存撑爆）', async () => {
    const file = join(dir, 'toobig.png')
    writeFileSync(file, Buffer.alloc(MAX_IMAGE_BYTES + 1))

    await expect(readImageAsDataUrl(file)).rejects.toThrow(/背景图片太大/)
  })
})
