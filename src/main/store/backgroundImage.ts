/**
 * 终端背景图：读取用户选择的图片文件，按扩展名生成 data: URL（CSP 允许 img-src data:）。
 * 文件不存在返回 null（背景回退纯色，由设置弹窗提示）；不 import electron。
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

/** 系统文件对话框的过滤扩展名（与 MIME 表一致） */
export const IMAGE_EXTENSIONS = Object.keys(MIME_BY_EXT).map((ext) => ext.slice(1))

export async function readImageAsDataUrl(file: string): Promise<string | null> {
  const mime = MIME_BY_EXT[extname(file).toLowerCase()]
  if (!mime) throw new Error(`不支持的图片格式：${file}`)
  let bytes: Buffer
  try {
    bytes = await readFile(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`[store] 背景图片不存在，回退纯色：${file}`)
      return null
    }
    throw err
  }
  return `data:${mime};base64,${bytes.toString('base64')}`
}
