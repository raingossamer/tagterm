import { describe, expect, it } from 'vitest'
import { reorderWithinGroup } from '../../src/renderer/src/composables/sessionOrder'

describe('reorderWithinGroup', () => {
  // 全局 9 个，iot 组占着第 3、7、9 位（下标 2 / 6 / 8）
  const all = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
  const group = ['c', 'g', 'i']

  it('组内把最后一个拖到最前：只有该组占的槽位换了内容，组外会话原地不动', () => {
    expect(reorderWithinGroup(all, group, 2, 0)).toEqual([
      'a',
      'b',
      'i', // 原 c 的槽
      'd',
      'e',
      'f',
      'c', // 原 g 的槽
      'h',
      'g', // 原 i 的槽
    ])
  })

  it('往后拖同样只换槽位；连续成组时等价于普通的列表移动', () => {
    expect(reorderWithinGroup(all, group, 0, 2)).toEqual([
      'a',
      'b',
      'g',
      'd',
      'e',
      'f',
      'i',
      'h',
      'c',
    ])
    expect(reorderWithinGroup(all, ['a', 'b', 'c'], 0, 2)).toEqual([
      'b',
      'c',
      'a',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
    ])
  })

  it('原地 / 越界 / 组内少于两项 → 原样返回全局顺序', () => {
    expect(reorderWithinGroup(all, group, 1, 1)).toEqual(all)
    expect(reorderWithinGroup(all, group, -1, 0)).toEqual(all)
    expect(reorderWithinGroup(all, group, 0, 3)).toEqual(all)
    expect(reorderWithinGroup(all, ['c'], 0, 0)).toEqual(all)
    expect(reorderWithinGroup(all, [], 0, 1)).toEqual(all)
  })

  it('groupIds 里不在全局列表中的 id 一律忽略（广播中间态的悬空引用）', () => {
    expect(reorderWithinGroup(all, ['c', '不存在', 'i'], 1, 0)).toEqual([
      'a',
      'b',
      'i',
      'd',
      'e',
      'f',
      'g',
      'h',
      'c',
    ])
  })

  it('不改入参：返回新数组，原数组不动', () => {
    const snapshot = [...all]
    reorderWithinGroup(all, group, 2, 0)
    expect(all).toEqual(snapshot)
  })
})
