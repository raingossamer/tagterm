/**
 * 全局背景图：读取用户选择的图片文件，按扩展名生成 data: URL（CSP 允许 img-src data:）。
 * 文件不存在返回 null（背景回退纯色，由设置弹窗提示）；不 import electron ——
 * 缩图要用 Electron 的 nativeImage，按分层约定由装配层包成 ShrinkImage 回调注入。
 */
import { readFile, stat } from 'node:fs/promises'
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

/** 背景铺满整窗还要模糊，超过这个边长的图缩过再传，省渲染进程与 GPU 内存 */
export const MAX_IMAGE_EDGE = 2560
/** 单张背景图的体积上限：再大就别难为 IPC 与 base64 了 */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024

/** 缩图回调：最长边超过 maxEdge 时返回缩放后的字节与 MIME，无需缩放返回 null。mime 供实现决定用 JPEG 还是 PNG 编码 */
export type ShrinkImage = (
  bytes: Buffer,
  maxEdge: number,
  mime: string,
) => { bytes: Buffer; mime: string } | null

export async function readImageAsDataUrl(
  file: string,
  shrink?: ShrinkImage,
): Promise<string | null> {
  const mime = MIME_BY_EXT[extname(file).toLowerCase()]
  if (!mime) throw new Error(`不支持的图片格式：${file}`)
  let size: number
  try {
    size = (await stat(file)).size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`[store] 背景图片不存在，回退纯色：${file}`)
      return null
    }
    throw err
  }
  if (size > MAX_IMAGE_BYTES) {
    const mb = Math.round(size / 1024 / 1024)
    throw new Error(`背景图片太大（${mb} MB），请换一张小于 ${MAX_IMAGE_BYTES / 1024 / 1024} MB 的`)
  }
  const bytes = await readFile(file)
  const shrunk = shrink?.(bytes, MAX_IMAGE_EDGE, mime) ?? null
  return shrunk
    ? `data:${shrunk.mime};base64,${shrunk.bytes.toString('base64')}`
    : `data:${mime};base64,${bytes.toString('base64')}`
}
