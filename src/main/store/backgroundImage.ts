/**
 * 全局背景图：读取用户选择的图片文件，按扩展名给出 MIME 与原始字节，渲染进程自己建 Blob 对象 URL（CSP 放行 img-src blob:；
 * 此前是 base64 的 data: URL，主进程多一次编码、渲染进程多持有两份 2 MB 级的字符串，perf-startup-memory 行为 7）。
 * 文件不存在返回 null（背景回退纯色，由设置弹窗提示）；不 import electron ——
 * 缩图要用 Electron 的 nativeImage，按分层约定由装配层包成 ShrinkImage 回调注入。
 */
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { BackgroundImageData } from '@shared/ipc'

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
/** 单张背景图的体积上限：再大就别难为 IPC 与内存了 */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024

/** 缩图回调：最长边超过 maxEdge 时返回缩放后的字节与 MIME，无需缩放返回 null。mime 供实现决定用 JPEG 还是 PNG 编码 */
export type ShrinkImage = (
  bytes: Buffer,
  maxEdge: number,
  mime: string,
) => { bytes: Buffer; mime: string } | null

export async function readImageBytes(
  file: string,
  shrink?: ShrinkImage,
): Promise<BackgroundImageData | null> {
  const mime = mimeOf(file)
  if (!(await isPresentWithinLimit(file))) {
    console.warn(`[store] 背景图片不存在，回退纯色：${file}`)
    return null
  }
  const bytes = await readFile(file)
  const shrunk = shrink?.(bytes, MAX_IMAGE_EDGE, mime) ?? null
  return shrunk
    ? { mime: shrunk.mime, bytes: standalone(shrunk.bytes) }
    : { mime, bytes: standalone(bytes) }
}

/**
 * 交给 IPC 的字节数组要独占它的 ArrayBuffer：结构化克隆按整个 ArrayBuffer 拷贝，而 Node 的小 Buffer 可能只是缓冲池里的一段，
 * 原样交出去会把整片缓冲池（连同别人的数据）拷到渲染进程。独占的直接换成普通 Uint8Array 视图，共用的切出一份
 */
function standalone(buf: Buffer): Uint8Array<ArrayBuffer> {
  const isWholeBuffer = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
  // readFile / nativeImage 给的 Buffer 都是普通 ArrayBuffer 背后的（Node 类型只写成 ArrayBufferLike）
  return isWholeBuffer ? new Uint8Array(buf.buffer as ArrayBuffer) : new Uint8Array(buf)
}

/**
 * 保存前的检查（只看扩展名与大小、不读内容）：读取时会被拒绝的图（格式不支持、超过体积上限）抛同一句中文；
 * 文件不存在不抛 —— 与读取一样回退纯色
 */
export async function assertImageReadable(file: string): Promise<void> {
  mimeOf(file)
  await isPresentWithinLimit(file)
}

function mimeOf(file: string): string {
  const mime = MIME_BY_EXT[extname(file).toLowerCase()]
  if (!mime) throw new Error(`不支持的图片格式：${file}`)
  return mime
}

/** 文件在且不超过体积上限为 true，不存在为 false，超过上限抛错 */
async function isPresentWithinLimit(file: string): Promise<boolean> {
  let size: number
  try {
    size = (await stat(file)).size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
  if (size > MAX_IMAGE_BYTES) {
    const mb = Math.round(size / 1024 / 1024)
    throw new Error(`背景图片太大（${mb} MB），请换一张小于 ${MAX_IMAGE_BYTES / 1024 / 1024} MB 的`)
  }
  return true
}
