import { describe, expect, it } from 'vitest'
import {
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
