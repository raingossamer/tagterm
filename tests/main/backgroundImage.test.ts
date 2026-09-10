import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readImageAsDataUrl } from '../../src/main/store/backgroundImage'

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
})
