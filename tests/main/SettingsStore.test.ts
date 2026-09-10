import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/store/SettingsStore'
import type { Settings } from '@shared/models'

// 用真实临时目录，不 mock fs；PATH 探测结果以 seedCommands 注入
describe('SettingsStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-settings-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('首次运行（无文件）按注入的探测结果生成唤起命令并写出 settings.json v1，背景为缺省值', async () => {
    const store = new SettingsStore(dir, { seedCommands: ['claude', 'gemini', 'pi'] })
    await store.load()

    const settings = store.get()
    expect(settings.launchCommands.map((c) => [c.label, c.command, c.pinned, c.sortOrder])).toEqual(
      [
        ['claude', 'claude', true, 1],
        ['gemini', 'gemini', true, 2],
        ['pi', 'pi', true, 3],
      ],
    )
    expect(new Set(settings.launchCommands.map((c) => c.id)).size).toBe(3)
    expect(settings.terminalBackground).toEqual({ imagePath: null, dimOpacity: 0.6 })

    const file = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(file).toEqual({ version: 1, ...settings })
  })

  it('文件已存在时完全以文件为准，不再按探测结果增删', async () => {
    const first = new SettingsStore(dir, { seedCommands: ['claude'] })
    await first.load()

    const reloaded = new SettingsStore(dir, { seedCommands: ['claude', 'gemini', 'codex'] })
    await reloaded.load()
    expect(reloaded.get()).toEqual(first.get())
  })

  it('格式不正确 / 版本过高 / 坏 JSON 的文件拒绝加载并提示路径，不静默重置', async () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ version: 1, launchCommands: 'nope' }), 'utf8')
    await expect(new SettingsStore(dir, { seedCommands: [] }).load()).rejects.toThrow(file)

    writeFileSync(file, JSON.stringify({ version: 99, launchCommands: [] }), 'utf8')
    await expect(new SettingsStore(dir, { seedCommands: [] }).load()).rejects.toThrow(/版本/)

    writeFileSync(file, '{ not json', 'utf8')
    await expect(new SettingsStore(dir, { seedCommands: [] }).load()).rejects.toThrow(file)
  })

  it('update 以补丁合并：新命令自动分配 id、已有 id 保留；每次变更落盘并回调全量设置', async () => {
    const received: Settings[] = []
    const store = new SettingsStore(dir, {
      seedCommands: ['claude'],
      onChanged: (settings) => received.push(settings),
    })
    await store.load()
    const [claude] = store.get().launchCommands

    const updated = await store.update({
      launchCommands: [
        { label: 'pi 模型 x', command: 'pi --model x', pinned: false, sortOrder: 1 },
        { ...claude!, sortOrder: 2 },
      ],
    })
    expect(updated.launchCommands[0]).toMatchObject({ command: 'pi --model x', pinned: false })
    expect(updated.launchCommands[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(updated.launchCommands[1]).toEqual({ ...claude, sortOrder: 2 })

    await store.update({ terminalBackground: { imagePath: 'D:/bg.png', dimOpacity: 0.3 } })
    expect(store.get().terminalBackground).toEqual({ imagePath: 'D:/bg.png', dimOpacity: 0.3 })
    expect(store.get().launchCommands).toEqual(updated.launchCommands)
    expect(received).toEqual([updated, store.get()])

    const reloaded = new SettingsStore(dir, { seedCommands: [] })
    await reloaded.load()
    expect(reloaded.get()).toEqual(store.get())
  })
})
