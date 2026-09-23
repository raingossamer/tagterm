import { describe, expect, it } from 'vitest'
import {
  dropLaunchCommand,
  moveItem,
  normalizeLaunchCommands,
  splitPinned,
} from '../../src/renderer/src/composables/launchCommands'
import type { LaunchCommand } from '@shared/models'

function cmd(partial: Partial<LaunchCommand> & { command: string }): LaunchCommand {
  return { id: partial.command, label: partial.command, pinned: true, sortOrder: 0, ...partial }
}

describe('launchCommands 纯函数', () => {
  it('moveItem 把元素从 from 挪到 to，不改原数组；越界或同位置原样返回', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveItem(list, 0, 3)).toEqual(['b', 'c', 'd', 'a'])
    expect(moveItem(list, 1, 1)).toEqual(list)
    expect(moveItem(list, 9, 0)).toEqual(list)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('splitPinned 按 sortOrder 分成平铺区与「更多」两组', () => {
    const list = [
      cmd({ command: 'pi', pinned: false, sortOrder: 3 }),
      cmd({ command: 'claude', sortOrder: 2 }),
      cmd({ command: 'gemini', sortOrder: 1 }),
      cmd({ command: 'codex', pinned: false, sortOrder: 0 }),
    ]
    const { pinned, more } = splitPinned(list)
    expect(pinned.map((c) => c.command)).toEqual(['gemini', 'claude'])
    expect(more.map((c) => c.command)).toEqual(['codex', 'pi'])
  })

  it('normalizeLaunchCommands：去空白、显示名缺省 = 命令、命令留空的行丢弃、按位置重排 sortOrder', () => {
    const rows = [
      { id: 'a', label: '  ', command: ' claude ', pinned: true, sortOrder: 7 },
      { label: 'x', command: '   ', pinned: false, sortOrder: 1 },
      { label: ' pi 模型 x ', command: 'pi --model x', pinned: false, sortOrder: 0 },
    ]
    expect(normalizeLaunchCommands(rows)).toEqual([
      { id: 'a', label: 'claude', command: 'claude', pinned: true, sortOrder: 1 },
      { label: 'pi 模型 x', command: 'pi --model x', pinned: false, sortOrder: 2 },
    ])
  })
})

describe('dropLaunchCommand（路径条拖拽落点 → 新的唤起命令列表）', () => {
  // 路径条上：常用 a b c 平铺，「更多」里 d e
  const list = [
    cmd({ command: 'a', sortOrder: 1 }),
    cmd({ command: 'b', sortOrder: 2 }),
    cmd({ command: 'c', sortOrder: 3 }),
    cmd({ command: 'd', pinned: false, sortOrder: 4 }),
    cmd({ command: 'e', pinned: false, sortOrder: 5 }),
  ]
  const ids = (result: LaunchCommand[], pinned: boolean): string =>
    result
      .filter((c) => c.pinned === pinned)
      .map((c) => c.id)
      .join(' ')
  /** 结果写成「常用 | 更多」两段，便于读 */
  const layout = (result: LaunchCommand[] | null): string =>
    result ? `${ids(result, true)} | ${ids(result, false)}` : 'null'

  it('常用区内换位：落点是「插在第 index 个按钮前」（按拖动前的显示位置算）；排序号按常用在前重写为 1..n', () => {
    const result = dropLaunchCommand(list, 'a', { zone: 'pinned', index: 2 })
    expect(layout(result)).toBe('b a c | d e')
    expect(result!.map((c) => c.sortOrder)).toEqual([1, 2, 3, 4, 5])
    expect(layout(dropLaunchCommand(list, 'c', { zone: 'pinned', index: 0 }))).toBe('c a b | d e')
  })

  it('拖进「更多」变成非常用、插在落点（松在「更多 ▾」按钮上 = 末尾）；从「更多」拖回路径条变成常用；「更多」内换位', () => {
    const intoMore = dropLaunchCommand(list, 'b', { zone: 'more', index: 1 })
    expect(layout(intoMore)).toBe('a c | d b e')
    expect(intoMore!.find((c) => c.id === 'b')!.pinned).toBe(false)
    expect(layout(dropLaunchCommand(list, 'a', { zone: 'more', index: 2 }))).toBe('b c | d e a')
    expect(layout(dropLaunchCommand(list, 'a', { zone: 'more', index: 99 }))).toBe('b c | d e a')

    const back = dropLaunchCommand(list, 'e', { zone: 'pinned', index: 1 })
    expect(layout(back)).toBe('a e b c | d')
    expect(back!.find((c) => c.id === 'e')!.pinned).toBe(true)

    expect(layout(dropLaunchCommand(list, 'e', { zone: 'more', index: 0 }))).toBe('a b c | e d')
  })

  it('原来的 sortOrder 常用与非常用交错（编辑弹窗里排的）时，结果照样常用在前、重写为 1..n', () => {
    const mixed = [
      cmd({ command: 'd', pinned: false, sortOrder: 1 }),
      cmd({ command: 'a', sortOrder: 2 }),
      cmd({ command: 'b', sortOrder: 3 }),
    ]
    const result = dropLaunchCommand(mixed, 'b', { zone: 'pinned', index: 0 })
    expect(result!.map((c) => [c.id, c.sortOrder])).toEqual([
      ['b', 1],
      ['a', 2],
      ['d', 3],
    ])
  })

  it('落点就是原位（自己前后的缝）或拖的命令不存在 → null，不用保存', () => {
    expect(dropLaunchCommand(list, 'b', { zone: 'pinned', index: 1 })).toBeNull()
    expect(dropLaunchCommand(list, 'b', { zone: 'pinned', index: 2 })).toBeNull()
    expect(dropLaunchCommand(list, 'e', { zone: 'more', index: 2 })).toBeNull()
    expect(dropLaunchCommand(list, 'ghost', { zone: 'pinned', index: 0 })).toBeNull()
  })
})
