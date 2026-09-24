import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { AutoLaunchStatus, HookAgent, HooksStatus, HooksStatusMap } from '@shared/ipc'
import {
  ConfigService,
  defaultExportName,
  MAX_CONFIG_FILE_BYTES,
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
  /** 非空即模拟系统登录项写不了（开发版） */
  let autoLaunchError = ''
  let hooksInstalled: Record<HookAgent, boolean>
  /** 非空即模拟该目标装 / 卸失败 */
  let hooksError: Partial<Record<HookAgent, string>> = {}
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
      const error = hooksError[agent]
      if (error) throw new Error(error)
      hooksInstalled[agent] = enabled
      return { installed: enabled, port: 51000, settingsPath: `C:/fake/${agent}.json` }
    },
  }
  const autoLaunchPort = {
    get: () => autoLaunch,
    set: (enabled: boolean) => {
      if (autoLaunchError) throw new Error(autoLaunchError)
      autoLaunch = { enabled, blockedBySystem: false }
      return autoLaunch
    },
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

  /** 写一份配置文件到临时目录，返回路径 */
  function writeConfig(name: string, data: Record<string, unknown>): string {
    const path = join(dir, name)
    writeFileSync(path, JSON.stringify({ format: 'tagterm-config', version: 1, ...data }))
    return path
  }
  const backupsDir = () => join(dir, 'backups')
  const settingsText = () => readFileSync(join(dir, 'settings.json'), 'utf8')

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
    autoLaunchError = ''
    hooksInstalled = { claude: true, codex: false }
    hooksError = {}
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

  describe('导入', () => {
    it('对话框取消返回 null，不备份、什么都不动', async () => {
      await expect(
        build(fakeDialogs({ open: null })).importConfig({ terminalFontSize: 14 }),
      ).resolves.toBeNull()
      expect(existsSync(backupsDir())).toBe(false)
    })

    it('整份文件：先把当前偏好备份到 backups 下，再逐项应用 —— 标签按名合并（同名沿用 id、关联不动）、唤起命令替换、外观四参数生效而图片路径不变、全局快捷键注册并落盘、开机自启写系统、hooks 按目标装 / 卸、字号带回', async () => {
      const java = await tags.create('java', '#C98A0C')
      await tags.attach('s1', java.id)
      await settings.update({
        background: { ...settings.get().background, imagePath: 'D:/wall/bg.png' },
      })
      const file = writeConfig('in.json', {
        tags: [
          { name: 'simba', color: '#2F6FDB' },
          { name: 'java', color: '#2A9D5C', hidden: true },
        ],
        launchCommands: [{ label: 'g', command: 'gemini', pinned: false }],
        appearance: { fit: 'tile', imageOpacity: 0.5, panelOpacity: 0.9, blurPx: 0 },
        globalShortcut: { enabled: true, accelerator: 'Ctrl+Alt+Y' },
        autoLaunch: false,
        hooks: { claude: false, codex: true },
        terminalFontSize: 18,
      })
      const service = build(fakeDialogs({ open: file }))
      const before = await service.collect({ terminalFontSize: 14 })

      const result = await service.importConfig({ terminalFontSize: 14 })
      expect(result).not.toBeNull()
      expect(result!.path).toBe(file)
      expect(result!.terminalFontSize).toBe(18)
      expect(result!.items).toEqual([
        { key: 'tags', outcome: 'applied', message: '新建 1 个、更新 1 个' },
        { key: 'launchCommands', outcome: 'applied' },
        { key: 'appearance', outcome: 'applied' },
        { key: 'globalShortcut', outcome: 'applied' },
        { key: 'autoLaunch', outcome: 'applied' },
        { key: 'hooks', outcome: 'applied' },
        { key: 'terminalFontSize', outcome: 'applied' },
      ])

      // 备份 = 导入前的偏好，按同一格式
      expect(basename(result!.backupPath)).toMatch(/^tagterm-config-\d{8}-\d{6}\.json$/)
      expect(result!.backupPath.startsWith(backupsDir())).toBe(true)
      expect(parseConfigFile(readFileSync(result!.backupPath, 'utf8'))).toEqual(before)
      expect(readdirSync(backupsDir())).toEqual([basename(result!.backupPath)]) // 不留 .tmp

      const { tags: list, sessionTags } = tags.list()
      expect(list.map((t) => [t.name, t.color, t.hidden ?? false])).toEqual([
        ['simba', '#2F6FDB', false],
        ['java', '#2A9D5C', true],
      ])
      expect(list[1]!.id).toBe(java.id)
      expect(sessionTags).toEqual([{ sessionId: 's1', tagId: java.id }])
      const after = settings.get()
      expect(after.launchCommands.map((c) => [c.label, c.command, c.pinned, c.sortOrder])).toEqual([
        ['g', 'gemini', false, 1],
      ])
      expect(after.background).toEqual({
        imagePath: 'D:/wall/bg.png',
        fit: 'tile',
        imageOpacity: 0.5,
        panelOpacity: 0.9,
        blurPx: 0,
      })
      expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Y' })
      expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+Y'])
      expect(autoLaunch.enabled).toBe(false)
      expect(hookCalls).toEqual([
        ['claude', false],
        ['codex', true],
      ])
    })

    it('只给几项：其余报「文件里没有」，本机不动（settings.json 内容不变、不碰 hooks 与登录项）', async () => {
      const file = writeConfig('tags-only.json', { tags: [{ name: '甲', color: '#2F6FDB' }] })
      const before = settingsText()
      const result = await build(fakeDialogs({ open: file })).importConfig({ terminalFontSize: 14 })
      expect(result!.items).toEqual([
        { key: 'tags', outcome: 'applied', message: '新建 1 个、更新 0 个' },
        { key: 'launchCommands', outcome: 'absent' },
        { key: 'appearance', outcome: 'absent' },
        { key: 'globalShortcut', outcome: 'absent' },
        { key: 'autoLaunch', outcome: 'absent' },
        { key: 'hooks', outcome: 'absent' },
        { key: 'terminalFontSize', outcome: 'absent' },
      ])
      expect(result!.terminalFontSize).toBeUndefined()
      expect(settingsText()).toBe(before)
      expect(hookCalls).toEqual([])
      expect(autoLaunch.enabled).toBe(true)
    })

    it('导入自己刚导出的文件：各项报「未变」，不写 settings.json、不动 hooks 与热键', async () => {
      await tags.create('simba')
      const out = join(dir, 'export.json')
      await build(fakeDialogs({ save: out })).exportConfig({ terminalFontSize: 14 })
      const before = settingsText()
      const result = await build(fakeDialogs({ open: out })).importConfig({ terminalFontSize: 14 })
      expect(result!.items.map((i) => i.outcome)).toEqual(Array(7).fill('unchanged'))
      expect(settingsText()).toBe(before)
      expect(hookCalls).toEqual([])
      expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+T'])
    })

    it('文件不对 / 不存在 / 过大：原样抛，不备份、什么都不动', async () => {
      const before = settingsText()
      const run = (open: string) =>
        build(fakeDialogs({ open })).importConfig({ terminalFontSize: 14 })

      const bad = join(dir, 'bad.json')
      writeFileSync(bad, '{ "format": "other" }')
      await expect(run(bad)).rejects.toThrow('不是 TagTerm 配置文件')

      const invalidItem = writeConfig('item.json', { autoLaunch: 'yes' })
      await expect(run(invalidItem)).rejects.toThrow('配置文件里的开机自启格式不正确')

      await expect(run(join(dir, 'missing.json'))).rejects.toThrow('配置文件不存在：')

      const huge = join(dir, 'huge.json')
      writeFileSync(huge, ' '.repeat(MAX_CONFIG_FILE_BYTES + 1))
      await expect(run(huge)).rejects.toThrow('配置文件过大')

      expect(existsSync(backupsDir())).toBe(false)
      expect(settingsText()).toBe(before)
    })

    it('各项互不阻挡：快捷键被占用、开机自启写不了、某个 hooks 目标装不上各自记失败并写原因，其余照常生效', async () => {
      port.occupied.add('Alt+F9')
      autoLaunchError = '开发模式下不能设置开机自启'
      hooksError = { codex: '找不到 Codex 的配置目录' }
      const file = writeConfig('partial-fail.json', {
        tags: [{ name: '甲', color: '#2F6FDB' }],
        globalShortcut: { enabled: true, accelerator: 'Alt+F9' },
        autoLaunch: false,
        hooks: { claude: false, codex: true },
        terminalFontSize: 20,
      })
      const result = await build(fakeDialogs({ open: file })).importConfig({ terminalFontSize: 14 })
      expect(result!.items).toEqual([
        { key: 'tags', outcome: 'applied', message: '新建 1 个、更新 0 个' },
        { key: 'launchCommands', outcome: 'absent' },
        { key: 'appearance', outcome: 'absent' },
        { key: 'globalShortcut', outcome: 'failed', message: '该快捷键已被其他程序占用' },
        { key: 'autoLaunch', outcome: 'failed', message: '开发模式下不能设置开机自启' },
        { key: 'hooks', outcome: 'failed', message: 'Codex：找不到 Codex 的配置目录' },
        { key: 'terminalFontSize', outcome: 'applied' },
      ])
      expect(result!.terminalFontSize).toBe(20)
      expect([...port.registered.keys()]).toEqual(['Ctrl+Alt+T'])
      expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+T' })
      expect(autoLaunch.enabled).toBe(true)
      expect(hooksInstalled).toEqual({ claude: false, codex: false }) // claude 卸掉了，codex 没装上
      expect(tags.list().tags.map((t) => t.name)).toEqual(['甲'])
    })

    it('文件里的标签只是先后不同：标签报「已应用（只调整了顺序）」', async () => {
      await tags.create('a', '#2F6FDB')
      await tags.create('b', '#2A9D5C')
      const file = writeConfig('in.json', {
        tags: [
          { name: 'b', color: '#2A9D5C' },
          { name: 'a', color: '#2F6FDB' },
        ],
      })
      const result = await build(fakeDialogs({ open: file })).importConfig({ terminalFontSize: 14 })
      expect(result!.items[0]).toEqual({ key: 'tags', outcome: 'applied', message: '只调整了顺序' })
      expect(tags.list().tags.map((t) => t.name)).toEqual(['b', 'a'])
    })

    it('备份只留最近 10 份；同一秒内两次导入撞名加序号', async () => {
      mkdirSync(backupsDir(), { recursive: true })
      for (let i = 0; i < 10; i += 1) {
        writeFileSync(join(backupsDir(), `tagterm-config-20200101-00000${i}.json`), '{}')
      }
      const file = writeConfig('in.json', { terminalFontSize: 12 })
      const first = await build(fakeDialogs({ open: file })).importConfig({ terminalFontSize: 14 })
      const names = readdirSync(backupsDir()).sort()
      expect(names).toHaveLength(10)
      expect(names).not.toContain('tagterm-config-20200101-000000.json')
      expect(names).toContain(basename(first!.backupPath))

      const second = await build(fakeDialogs({ open: file })).importConfig({ terminalFontSize: 14 })
      expect(second!.backupPath).toBe(first!.backupPath.replace(/\.json$/, '-2.json'))
      expect(readdirSync(backupsDir())).toHaveLength(10)
    })
  })
})
