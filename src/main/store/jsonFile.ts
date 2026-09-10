/**
 * JSON 文件读写：读不存在的文件返回 null；写入先写同目录 .tmp 再 rename 覆盖（原子写）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

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
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}
