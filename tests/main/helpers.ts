/** 轮询等待条件成立（真实进程输出有延迟） */
export async function waitFor(cond: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await new Promise((r) => setTimeout(r, 25))
  }
}
