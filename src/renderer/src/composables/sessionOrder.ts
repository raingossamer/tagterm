/**
 * 会话组内拖拽排序的纯计算。
 *
 * 会话顺序只有一份全局的 `Session.sortOrder`，而同一个会话会出现在它所有标签的分组下，
 * 所以「组内顺序」是全局顺序在该组上的投影。拖拽用**槽位置换**：
 * 该组成员在全局序列里占着哪几个下标，重排后就按新顺序填回这几个下标，
 * 组外的会话一个都不挪。这样任何子集（标签组 / 交集组 / 未打标签组）都用同一套规则。
 */
import { moveItem } from './launchCommands'

/**
 * 把 groupIds 在 allIds 里占据的那些槽位按「组内 from → to」重排，返回新的全局 id 顺序。
 * from / to 是**组内**下标；越界、原地、组内不足两项都原样返回 allIds。
 */
export function reorderWithinGroup(
  allIds: readonly string[],
  groupIds: readonly string[],
  from: number,
  to: number,
): string[] {
  // 组内成员在全局序列里的下标（按全局顺序升序）；不在全局列表里的 id 忽略
  const members = new Set(groupIds)
  const slots: number[] = []
  for (let i = 0; i < allIds.length; i += 1) {
    if (members.has(allIds[i]!)) slots.push(i)
  }
  // 原地 / 越界 / 组内不足两项都不必单独挡：moveItem 对这些情况原样返回，填回槽位后全局顺序不变
  const ordered = moveItem(
    slots.map((i) => allIds[i]!),
    from,
    to,
  )
  const next = [...allIds]
  slots.forEach((slot, i) => {
    next[slot] = ordered[i]!
  })
  return next
}
