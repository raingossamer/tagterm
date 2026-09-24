import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertImageReadable,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  readImageBytes,
} from '../../src/main/store/backgroundImage'

// 1×1 PNG 的字节（测试不依赖真实图片资源）
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('readImageBytes（背景图：扩展名对应的 MIME + 原始字节，不再 base64）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-bg-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('读取图片文件：MIME 按扩展名（大小写不计），字节原样；字节数组独占它的 ArrayBuffer（结构化克隆按整个 ArrayBuffer 拷贝，不能把 Node 的缓冲池整片带过去）', async () => {
    const file = join(dir, 'wall.PNG')
    writeFileSync(file, PNG_BYTES)

    const image = await readImageBytes(file)
    expect(image?.mime).toBe('image/png')
    expect(Buffer.from(image!.bytes).equals(PNG_BYTES)).toBe(true)
    expect(Buffer.isBuffer(image!.bytes)).toBe(false)
    expect(image!.bytes.byteLength).toBe(image!.bytes.buffer.byteLength)
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
      expect((await readImageBytes(file))?.mime).toBe(mime)
    }
    writeFileSync(join(dir, 'a.txt'), 'x')
    await expect(readImageBytes(join(dir, 'a.txt'))).rejects.toThrow(/不支持的图片格式/)
  })

  it('文件不存在时返回 null（背景回退纯色，不报错）', async () => {
    await expect(readImageBytes(join(dir, 'missing.png'))).resolves.toBeNull()
  })

  it('注入的缩图回调返回结果时用它的字节与 MIME；返回 null 表示无需缩放，原样输出', async () => {
    const file = join(dir, 'huge.jpg')
    writeFileSync(file, PNG_BYTES)
    const calls: Array<{ bytes: number; maxEdge: number }> = []
    const shrunk = Buffer.from('shrunk')

    const image = await readImageBytes(file, (bytes, maxEdge) => {
      calls.push({ bytes: bytes.length, maxEdge })
      return { bytes: shrunk, mime: 'image/png' }
    })
    expect(calls).toEqual([{ bytes: PNG_BYTES.length, maxEdge: MAX_IMAGE_EDGE }])
    expect(image?.mime).toBe('image/png')
    expect(Buffer.from(image!.bytes).equals(shrunk)).toBe(true)

    // 回调说「不用缩」→ 原文件字节与扩展名对应的 MIME
    const original = await readImageBytes(file, () => null)
    expect(original?.mime).toBe('image/jpeg')
    expect(Buffer.from(original!.bytes).equals(PNG_BYTES)).toBe(true)
  })

  it('文件超过体积上限时抛错，提示换一张（避免超大图把 IPC 与内存撑爆）', async () => {
    const file = join(dir, 'toobig.png')
    writeFileSync(file, Buffer.alloc(MAX_IMAGE_BYTES + 1))

    await expect(readImageBytes(file)).rejects.toThrow(/背景图片太大/)
  })
})

describe('assertImageReadable（保存前的检查，只看扩展名与大小、不读内容）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-bg-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('读取时会被拒绝的图（格式不支持、超过体积上限）抛同一句中文；读得出来的与不存在的都放行', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x')
    await expect(assertImageReadable(join(dir, 'a.txt'))).rejects.toThrow(/不支持的图片格式/)
    writeFileSync(join(dir, 'toobig.png'), Buffer.alloc(MAX_IMAGE_BYTES + 1))
    await expect(assertImageReadable(join(dir, 'toobig.png'))).rejects.toThrow(
      '背景图片太大（30 MB），请换一张小于 30 MB 的',
    )

    writeFileSync(join(dir, 'ok.png'), PNG_BYTES)
    await expect(assertImageReadable(join(dir, 'ok.png'))).resolves.toBeUndefined()
    // 不存在：读取时回退纯色、不报错，保存时同样不拦
    await expect(assertImageReadable(join(dir, 'missing.png'))).resolves.toBeUndefined()
  })
})
