/**
 * 唤起命令的纯计算：拖拽排序、平铺区 / 「更多」拆分、编辑弹窗保存前的规整。
 */
import type { LaunchCommandInput } from '@shared/ipc'
import type { LaunchCommand } from '@shared/models'

/** 把 from 位置的元素挪到 to 位置（返回新数组）；越界或同位置原样返回 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list]
  if (from === to || from < 0 || to < 0 || from >= copy.length || to >= copy.length) return copy
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item as T)
  return copy
}

const bySortOrder = (a: LaunchCommand, b: LaunchCommand): number => a.sortOrder - b.sortOrder

export function splitPinned(commands: readonly LaunchCommand[]): {
  pinned: LaunchCommand[]
  more: LaunchCommand[]
} {
  const sorted = [...commands].sort(bySortOrder)
  return { pinned: sorted.filter((c) => c.pinned), more: sorted.filter((c) => !c.pinned) }
}

/** 编辑弹窗的行 → 可提交的列表：去空白、显示名缺省 = 命令、命令留空的行丢弃、sortOrder = 位置 */
export function normalizeLaunchCommands(rows: readonly LaunchCommandInput[]): LaunchCommandInput[] {
  return rows
    .map((row) => ({ ...row, label: row.label.trim(), command: row.command.trim() }))
    .filter((row) => row.command)
    .map((row, i) => ({ ...row, label: row.label || row.command, sortOrder: i + 1 }))
}
