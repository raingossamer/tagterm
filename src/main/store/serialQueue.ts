/**
 * 串行队列：持久化 store 的变更经它一个接一个执行。
 * store 是「先按已提交的数据算出整份新数据 → 原子写 → 成功才换内存」，两次变更若并发，
 * 都会从同一份旧数据算起，后写完的那次把前一次冲掉（丢更新）；Windows 上同一份文件的两次 rename 并发还会 EPERM。
 * 排队后每次变更都从前一次提交后的数据算起。前一个失败只让它自己的调用方拿到错误，不挡后一个。
 */
export interface SerialQueue {
  /** 把 op 接在前一个之后执行，返回 op 自己的结果 */
  run<T>(op: () => Promise<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(op: () => Promise<T>): Promise<T> {
      const result = tail.then(op)
      tail = result.catch(() => {}) // 队尾永不拒绝：失败已经交给了 result 的调用方
      return result
    },
  }
}
