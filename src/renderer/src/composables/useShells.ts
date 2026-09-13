/**
 * 可用 shell 列表：向主进程探测 PATH 上存在的 shell（app.listShells），新建 / 编辑会话弹窗的 Shell 下拉共用。
 * 探测前列表只含当前值；探测到空列表保持缺省；当前值不在列表里时切到第一项；探测失败回调错误文案。
 */
import { ref, type Ref } from 'vue'
import type { ShellKind } from '@shared/models'

export interface Shells {
  shell: Ref<ShellKind>
  shells: Ref<ShellKind[]>
  /** 探测完成（成功或失败）后 resolve */
  ready: Promise<void>
}

export function useShells(initial: ShellKind, onError?: (message: string) => void): Shells {
  const shell = ref<ShellKind>(initial)
  const shells = ref<ShellKind[]>([initial])

  const ready = window.tagterm.app
    .listShells()
    .then((available) => {
      if (!available.length) return
      shells.value = available
      if (!available.includes(shell.value)) shell.value = available[0]!
    })
    .catch((err: unknown) => onError?.(err instanceof Error ? err.message : String(err)))

  return { shell, shells, ready }
}
