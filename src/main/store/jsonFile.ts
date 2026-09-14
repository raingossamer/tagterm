/**
 * JSON 文件读写：读不存在的文件返回 null；写入先写同目录 .tmp 再 rename 覆盖（原子写）。
 * 临时文件名每次唯一：固定用 `<文件>.tmp` 时，同一份文件的两次写入会互相覆盖临时文件，
 * 后完成的那次 rename 拿到 ENOENT —— 调用方（如 pty:open 里的 touchOpened）就会莫名其妙地失败。
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

let tmpSeq = 0

export async function readJson(file: string): Promise<unknown | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    return JSON.parse(text) as unknown
  } catch (err) {
    throw new Error(`数据文件损坏，无法解析：${file}（${(err as Error).message}）`)
  }
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}-${(tmpSeq += 1)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => {}) // 失败别把临时文件留在数据目录里
    throw err
  }
}
