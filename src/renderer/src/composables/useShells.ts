/**
 * 可用 shell 列表：向主进程探测 PATH 上存在的 shell（app.listShells），新建 / 编辑会话弹窗的 Shell 下拉共用。
 * 探测前列表只含当前值；探测到空列表保持缺省；探测失败回调错误文案。
 * 当前值不在列表里时：缺省切到第一项（新建会话：缺省值用不了就换一个能用的）；
 * keepCurrent 保留原值并补在列表末尾（编辑已有会话：不在 PATH 上不等于用不了 —— cmd / powershell 另有系统固定位置，
 * 更不能只改名就连带把 Shell 换掉、让主进程重启终端或以「有程序在跑」拒绝改名）
 */
import { ref, type Ref } from 'vue'
import type { ShellKind } from '@shared/models'

export interface Shells {
  shell: Ref<ShellKind>
  shells: Ref<ShellKind[]>
  /** 探测完成（成功或失败）后 resolve */
  ready: Promise<void>
}

export function useShells(
  initial: ShellKind,
  onError?: (message: string) => void,
  { keepCurrent = false }: { keepCurrent?: boolean } = {},
): Shells {
  const shell = ref<ShellKind>(initial)
  const shells = ref<ShellKind[]>([initial])

  const ready = window.tagterm.app
    .listShells()
    .then((available) => {
      if (!available.length) return
      if (available.includes(shell.value)) shells.value = available
      else if (keepCurrent) shells.value = [...available, shell.value]
      else {
        shells.value = available
        shell.value = available[0]!
      }
    })
    .catch((err: unknown) => onError?.(err instanceof Error ? err.message : String(err)))

  return { shell, shells, ready }
}
