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

/** 路径条上的两段：平铺的常用按钮、「更多 ▾」里的列表 */
export type LaunchZone = 'pinned' | 'more'

/** 拖拽落点：放进哪一段、插在该段第 index 个按钮前（按拖动前的显示位置算；等于段长 = 放到末尾） */
export interface LaunchDrop {
  zone: LaunchZone
  index: number
}

/**
 * 路径条上把一条唤起命令拖到落点后的新列表：常用在前、「更多」在后，sortOrder 整体重写为 1..n
 *（编辑弹窗里的列表随之变成常用在前）。落点就是原位、或拖的命令不存在时返回 null（不用保存）。
 */
export function dropLaunchCommand(
  commands: readonly LaunchCommand[],
  draggedId: string,
  drop: LaunchDrop,
): LaunchCommand[] | null {
  const dragged = commands.find((c) => c.id === draggedId)
  if (!dragged) return null
  const { pinned, more } = splitPinned(commands)
  const target = drop.zone === 'pinned' ? pinned : more
  let index = Math.max(0, Math.min(drop.index, target.length))
  const from = target.indexOf(dragged)
  if (from >= 0 && (index === from || index === from + 1)) return null // 松在自己前后的缝里 = 没动
  if (from >= 0 && from < index) index -= 1 // 同一段里往后拖：先拿掉自己，后面的都前移一格
  const nextPinned = pinned.filter((c) => c !== dragged)
  const nextMore = more.filter((c) => c !== dragged)
  const moved = { ...dragged, pinned: drop.zone === 'pinned' }
  ;(drop.zone === 'pinned' ? nextPinned : nextMore).splice(index, 0, moved)
  return [...nextPinned, ...nextMore].map((c, i) => ({ ...c, sortOrder: i + 1 }))
}

/** 编辑弹窗的行 → 可提交的列表：去空白、显示名缺省 = 命令、命令留空的行丢弃、sortOrder = 位置 */
export function normalizeLaunchCommands(rows: readonly LaunchCommandInput[]): LaunchCommandInput[] {
  return rows
    .map((row) => ({ ...row, label: row.label.trim(), command: row.command.trim() }))
    .filter((row) => row.command)
    .map((row, i) => ({ ...row, label: row.label || row.command, sortOrder: i + 1 }))
}
