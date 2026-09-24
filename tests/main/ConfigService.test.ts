import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutoLaunchStatus, HookAgent, HooksStatus, HooksStatusMap } from '@shared/ipc'
import {
  ConfigService,
  defaultExportName,
  type ConfigDialogPort,
} from '../../src/main/config/ConfigService'
import { parseConfigFile } from '../../src/main/config/configFile'
import { GlobalShortcut } from '../../src/main/shortcut/GlobalShortcut'
import { SettingsStore } from '../../src/main/store/SettingsStore'
import { TagStore } from '../../src/main/store/TagStore'
import { FakeShortcutPort } from './fakeShortcutPort'

const NOW = new Date('2026-09-24T08:00:00.000Z')

/** 假对话框：save / open 为 null 即模拟取消 */
function fakeDialogs(paths: { save?: string | null; open?: string | null }): ConfigDialogPort & {
  defaultNames: string[]
} {
  const defaultNames: string[] = []
  return {
    defaultNames,
    async pickSavePath(defaultName) {
      defaultNames.push(defaultName)
      return paths.save ?? null
    },
    async pickOpenPath() {
      return paths.open ?? null
    },
  }
}

describe('ConfigService', () => {
  let dir: string
  let settings: SettingsStore
  let tags: TagStore
  let port: FakeShortcutPort
  let shortcut: GlobalShortcut
  let autoLaunch: AutoLaunchStatus
  let hooksInstalled: Record<HookAgent, boolean>
  const hookCalls: Array<[HookAgent, boolean]> = []

  const hooks = {
    async hooksStatus(): Promise<HooksStatusMap> {
      const status = (agent: HookAgent): HooksStatus => ({
        installed: hooksInstalled[agent],
        port: 51000,
        settingsPath: `C:/fake/${agent}.json`,
      })
      return { claude: status('claude'), codex: status('codex') }
    },
    async setHooks(agent: HookAgent, enabled: boolean): Promise<HooksStatus> {
      hookCalls.push([agent, enabled])
      hooksInstalled[agent] = enabled
      return { installed: enabled, port: 51000, settingsPath: `C:/fake/${agent}.json` }
    },
  }
  const autoLaunchPort = {
    get: () => autoLaunch,
    set: (enabled: boolean) => (autoLaunch = { enabled, blockedBySystem: false }),
  }

  function build(dialogs: ConfigDialogPort): ConfigService {
    return new ConfigService({
      settings,
      tags,
      shortcut,
      autoLaunch: autoLaunchPort,
      hooks,
      dialogs,
      appVersion: '0.3.11',
      dataDir: dir,
      now: () => NOW,
    })
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-config-'))
    settings = new SettingsStore(dir, { seedCommands: ['claude', 'pi'] })
    await settings.load()
    tags = new TagStore(dir)
    await tags.load()
    port = new FakeShortcutPort()
    shortcut = new GlobalShortcut({ port, onPress: () => {} })
    shortcut.start(settings.getGlobalShortcut())
    autoLaunch = { enabled: true, blockedBySystem: false }
    hooksInstalled = { claude: true, codex: false }
    hookCalls.length = 0
  })
  afterEach(() => {
    shortcut.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('导出：缺省文件名带本地日期；把标签（按 sortOrder、含隐藏）、唤起命令、外观（不带图片路径）、全局快捷键、开机自启、hooks 开关、字号写成一份文件', async () => {
    const a = await tags.create('归档', '#6B7280')
    await tags.update(a.id, { hidden: true })
    await tags.create('simba', '#2F6FDB')
    await tags.reorder([(await tags.create('simba')).id, a.id])
    const { background } = settings.get()
    await settings.update({
      background: { ...background, imagePath: 'D:/wall/bg.png', fit: 'cover', blurPx: 8 },
    })
    await settings.setGlobalShortcut({ enabled: true, accelerator: 'Ctrl+Alt+Y' })

    const out = join(dir, 'out', 'my-config.json')
    const dialogs = fakeDialogs({ save: out })
    await expect(build(dialogs).exportConfig({ terminalFontSize: 16 })).resolves.toEqual({
      path: out,
    })
    expect(dialogs.defaultNames).toEqual([defaultExportName(NOW)])
    expect(defaultExportName(new Date(2026, 8, 4))).toBe('tagterm-config-20260904.json')

    const text = readFileSync(out, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toMatchObject({
      format: 'tagterm-config',
      version: 1,
      exportedAt: NOW.toISOString(),
      appVersion: '0.3.11',
    })
    expect(parseConfigFile(text)).toEqual({
      tags: [
        { name: 'simba', color: '#2F6FDB' },
        { name: '归档', color: '#6B7280', hidden: true },
      ],
      launchCommands: [
        { label: 'claude', command: 'claude', pinned: true },
        { label: 'pi', command: 'pi', pinned: true },
      ],
      appearance: { fit: 'cover', imageOpacity: 0.35, panelOpacity: 0.75, blurPx: 8 },
      globalShortcut: { enabled: true, accelerator: 'Ctrl+Alt+Y' },
      autoLaunch: true,
      hooks: { claude: true, codex: false },
      terminalFontSize: 16,
    })
    expect(readdirSync(join(dir, 'out'))).toEqual(['my-config.json']) // 不留 .tmp
  })

  it('导出：对话框取消返回 null，不写任何文件', async () => {
    await expect(
      build(fakeDialogs({ save: null })).exportConfig({ terminalFontSize: 14 }),
    ).resolves.toBeNull()
    expect(existsSync(join(dir, 'out'))).toBe(false)
  })
})
