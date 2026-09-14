import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerIpc, type IpcDeps } from '../../src/main/ipc'
import { SessionStore } from '../../src/main/store/SessionStore'
import { SettingsStore } from '../../src/main/store/SettingsStore'
import { TagStore } from '../../src/main/store/TagStore'
import { Updater } from '../../src/main/updater/Updater'
import { FakeAutoUpdater } from './fakeAutoUpdater'
import { PtyManager } from '../../src/main/pty/PtyManager'
import type { AutoLaunchStatus, PtyExitEvent, PtyOpenResult, TagListResult } from '@shared/ipc'
import type { Session, Settings, Tag, UpdateStatus } from '@shared/models'
import { createFakeIpcMain, type FakeIpcMain } from './fakeIpcMain'
import { waitFor } from './helpers'

describe('IPC 接口层', () => {
  let dir: string
  let ipc: FakeIpcMain
  let deps: IpcDeps
  let store: SessionStore
  let settings: SettingsStore
  let tags: TagStore
  let pty: PtyManager
  let autoUpdater: FakeAutoUpdater
  const updateStatuses: UpdateStatus[] = []
  const output: Record<string, string> = {}
  const exits: PtyExitEvent[] = []
  /** 假进程树：是否报告「shell 里有子进程」，以及被查询的次数 */
  let hasChildren = false
  let childQueries = 0
  /** 假登录项：开机自启状态 */
  let autoLaunch: AutoLaunchStatus = { enabled: false, blockedBySystem: false }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-ipc-'))
    store = new SessionStore(dir)
    await store.load()
    settings = new SettingsStore(dir, { seedCommands: ['claude', 'pi'] })
    await settings.load()
    tags = new TagStore(dir)
    await tags.load()
    pty = new PtyManager({
      onData: (id, d) => {
        output[id] = (output[id] ?? '') + d
      },
      onExit: (e) => exits.push(e),
    })
    ipc = createFakeIpcMain()
    autoUpdater = new FakeAutoUpdater()
    const updater = new Updater({
      autoUpdater,
      currentVersion: '0.1.0',
      onStatus: (s) => updateStatuses.push(s),
      beforeInstall: () => autoUpdater.order.push('before'),
    })
    deps = {
      version: '0.1.0',
      osBuild: 26200,
      store,
      settings,
      tags,
      updater,
      pty,
      dataDir: dir,
      pickImage: async () => join(dir, 'picked.png'),
      pickDirectory: async () => 'D:\\picked',
      listShells: () => ['cmd.exe', 'powershell.exe'],
      hasChildProcesses: async () => {
        childQueries += 1
        return hasChildren
      },
      getAutoLaunch: () => autoLaunch,
      setAutoLaunch: (enabled) => {
        autoLaunch = { enabled, blockedBySystem: false }
        return autoLaunch
      },
    }
    registerIpc(ipc, deps)
  })
  afterEach(() => {
    pty.killAll()
    hasChildren = false
    childQueries = 0
    autoLaunch = { enabled: false, blockedBySystem: false }
    exits.length = 0
    updateStatuses.length = 0
    for (const k of Object.keys(output)) delete output[k]
    rmSync(dir, { recursive: true, force: true })
  })

  it('app:get-version / app:get-os-build 返回装配层注入的值', async () => {
    await expect(ipc.invoke('app:get-version')).resolves.toBe('0.1.0')
    await expect(ipc.invoke('app:get-os-build')).resolves.toBe(26200)
  })

  it('session:create / list / update / remove 经接口层落到 SessionStore', async () => {
    const created = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    expect(created).toMatchObject({ name: 'x', cwd: 'D:\\x', shell: 'cmd.exe' })
    await expect(ipc.invoke('session:list')).resolves.toEqual([created])

    const updated = (await ipc.invoke('session:update', created.id, { name: 'n2' })) as Session
    expect(updated.name).toBe('n2')

    await ipc.invoke('session:remove', created.id)
    await expect(ipc.invoke('session:list')).resolves.toEqual([])
  })

  it('非法参数在接口层被拒绝', async () => {
    await expect(ipc.invoke('session:create', { cwd: '' })).rejects.toThrow(/目录/)
    await expect(ipc.invoke('session:create', { cwd: 'D:\\x', shell: 'bash' })).rejects.toThrow(
      /shell/i,
    )
    await expect(ipc.invoke('session:update', 123, {})).rejects.toThrow()
    await expect(ipc.invoke('session:remove', '')).rejects.toThrow()
    await expect(ipc.invoke('pty:open', 'x', { cols: 0, rows: 24 })).rejects.toThrow(/尺寸/)
    await expect(ipc.invoke('pty:resize', 'x', { cols: 80, rows: 1.5 })).rejects.toThrow(/尺寸/)
  })

  it('session:pick-directory 返回系统目录选择框的结果', async () => {
    await expect(ipc.invoke('session:pick-directory')).resolves.toBe('D:\\picked')
  })

  it('app:list-shells 返回本机可用的 shell', async () => {
    await expect(ipc.invoke('app:list-shells')).resolves.toEqual(['cmd.exe', 'powershell.exe'])
  })

  it('pty:open 按会话目录 / shell 起真实终端且幂等；写入 / 是否存活 / kill 经接口层生效', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session

    const first = (await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })) as PtyOpenResult
    expect(first.created).toBe(true)
    expect(first.pid).toBeGreaterThan(0)
    const again = (await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })) as PtyOpenResult
    expect(again).toEqual({ created: false, pid: first.pid })
    await expect(ipc.invoke('pty:is-alive', s.id)).resolves.toBe(true)
    expect(store.get(s.id).lastOpenedAt).toBeDefined()

    ipc.send('pty:write', s.id, 'echo via-ipc\r')
    await waitFor(() => (output[s.id] ?? '').includes('via-ipc'))
    await ipc.invoke('pty:resize', s.id, { cols: 100, rows: 30 })

    await ipc.invoke('pty:kill', s.id)
    await waitFor(() => exits.some((e) => e.sessionId === s.id))
    await expect(ipc.invoke('pty:is-alive', s.id)).resolves.toBe(false)
  })

  it('pty:open 不存在的会话报错', async () => {
    await expect(ipc.invoke('pty:open', 'missing', { cols: 80, rows: 24 })).rejects.toThrow(
      /会话不存在/,
    )
  })

  it('session:update 接受 cwd（trim 非空）；只改 name 不查子进程也不结束 pty', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session
    const moved = (await ipc.invoke('session:update', s.id, { cwd: ' D:\\y ' })) as Session
    expect(moved.cwd).toBe('D:\\y')
    expect(store.get(s.id).cwd).toBe('D:\\y')
    await expect(ipc.invoke('session:update', s.id, { cwd: '   ' })).rejects.toThrow('需要一个目录')

    await ipc.invoke('session:update', s.id, { cwd: process.cwd() })
    await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })
    hasChildren = true
    const renamed = (await ipc.invoke('session:update', s.id, { name: 'idle-rename' })) as Session
    expect(renamed.name).toBe('idle-rename')
    expect(childQueries).toBe(0)
    expect(pty.has(s.id)).toBe(true)
  })

  it('session:update 改 cwd / shell 时：shell 里有程序在跑 → reject 且不动；空闲 → 先结束 pty（exit 先到）再改，之后 pty:open 按新目录起', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session
    await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })
    await waitFor(() => />/.test(output[s.id] ?? ''))

    hasChildren = true
    await expect(
      ipc.invoke('session:update', s.id, { cwd: join(process.cwd(), 'tests') }),
    ).rejects.toThrow('终端里有程序正在运行，退出后再修改目录或 Shell')
    expect(store.get(s.id).cwd).toBe(process.cwd())
    expect(pty.has(s.id)).toBe(true)

    hasChildren = false
    const moved = (await ipc.invoke('session:update', s.id, {
      cwd: join(process.cwd(), 'tests'),
    })) as Session
    expect(exits.some((e) => e.sessionId === s.id)).toBe(true)
    expect(pty.has(s.id)).toBe(false)
    expect(moved.cwd).toBe(join(process.cwd(), 'tests'))

    output[s.id] = ''
    const reopened = (await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })) as PtyOpenResult
    expect(reopened.created).toBe(true)
    await waitFor(() => (output[s.id] ?? '').includes('tests>'))
  })

  it('app:get-auto-launch / app:set-auto-launch 转发装配层注入的登录项回调；非布尔参数被拒绝', async () => {
    await expect(ipc.invoke('app:get-auto-launch')).resolves.toEqual({
      enabled: false,
      blockedBySystem: false,
    })
    await expect(ipc.invoke('app:set-auto-launch', true)).resolves.toEqual({
      enabled: true,
      blockedBySystem: false,
    })
    await expect(ipc.invoke('app:get-auto-launch')).resolves.toEqual({
      enabled: true,
      blockedBySystem: false,
    })
    await expect(ipc.invoke('app:set-auto-launch', 'yes')).rejects.toThrow('开机自启参数必须是布尔')
  })

  it('session:remove 同时结束其 pty', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session
    await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })

    await ipc.invoke('session:remove', s.id)
    await waitFor(() => exits.some((e) => e.sessionId === s.id))
    expect(pty.has(s.id)).toBe(false)
    await expect(ipc.invoke('session:list')).resolves.toEqual([])
  })

  it('settings:get 返回当前设置；settings:update 以补丁合并后返回全量', async () => {
    const before = (await ipc.invoke('settings:get')) as Settings
    expect(before.launchCommands.map((c) => c.command)).toEqual(['claude', 'pi'])

    const after = (await ipc.invoke('settings:update', {
      launchCommands: [{ label: '', command: 'gemini', pinned: false, sortOrder: 1 }],
    })) as Settings
    expect(after.launchCommands).toHaveLength(1)
    expect(after.launchCommands[0]).toMatchObject({ command: 'gemini', pinned: false })
    expect(after.background).toEqual(before.background)
    await expect(ipc.invoke('settings:get')).resolves.toEqual(after)
  })

  it('app:get-data-dir / app:pick-image 返回装配层注入的值', async () => {
    await expect(ipc.invoke('app:get-data-dir')).resolves.toBe(dir)
    await expect(ipc.invoke('app:pick-image')).resolves.toBe(join(dir, 'picked.png'))
  })

  it('settings:read-background-image：未设置或文件不存在返回 null，存在则返回 data: URL', async () => {
    await expect(ipc.invoke('settings:read-background-image')).resolves.toBeNull()

    const file = join(dir, 'bg.png')
    await ipc.invoke('settings:update', {
      background: {
        imagePath: file,
        fit: 'cover',
        imageOpacity: 0.3,
        panelOpacity: 0.8,
        blurPx: 6,
      },
    })
    await expect(ipc.invoke('settings:read-background-image')).resolves.toBeNull()

    writeFileSync(file, Buffer.from('89504e470d0a1a0a', 'hex'))
    await expect(ipc.invoke('settings:read-background-image')).resolves.toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    )
  })

  it('update:get-status / check / download / install 经接口层落到 Updater', async () => {
    await expect(ipc.invoke('update:get-status')).resolves.toEqual({ state: 'idle' })

    await ipc.invoke('update:check')
    expect(autoUpdater.checkCalls).toBe(1)
    expect(updateStatuses).toEqual([{ state: 'checking' }])
    autoUpdater.emit('update-available', { version: '0.2.0' })
    await expect(ipc.invoke('update:get-status')).resolves.toEqual({
      state: 'available',
      version: '0.2.0',
    })

    await ipc.invoke('update:download')
    expect(autoUpdater.downloadCalls).toBe(1)

    await ipc.invoke('update:install')
    expect(autoUpdater.order).toEqual(['before', 'install'])
  })

  it('settings:update 非法补丁在接口层被拒绝', async () => {
    await expect(ipc.invoke('settings:update', { launchCommands: 'x' })).rejects.toThrow(/唤起命令/)
    await expect(
      ipc.invoke('settings:update', {
        launchCommands: [{ label: 'a', command: '  ', pinned: true, sortOrder: 1 }],
      }),
    ).rejects.toThrow(/命令不能为空/)
    await expect(
      ipc.invoke('settings:update', {
        launchCommands: [{ label: 'a', command: 'a', pinned: 'yes', sortOrder: 1 }],
      }),
    ).rejects.toThrow(/唤起命令/)
    const bg = { imagePath: null, fit: 'contain', imageOpacity: 0.3, panelOpacity: 0.8, blurPx: 4 }
    await expect(
      ipc.invoke('settings:update', { background: { ...bg, imageOpacity: 2 } }),
    ).rejects.toThrow(/不透明度/)
    await expect(
      ipc.invoke('settings:update', { background: { ...bg, panelOpacity: 0.2 } }),
    ).rejects.toThrow(/面板不透明度/)
    await expect(
      ipc.invoke('settings:update', { background: { ...bg, fit: 'stretch' } }),
    ).rejects.toThrow(/显示方式/)
    await expect(
      ipc.invoke('settings:update', { background: { ...bg, blurPx: 2.5 } }),
    ).rejects.toThrow(/模糊/)
    await expect(
      ipc.invoke('settings:update', { background: { ...bg, blurPx: 50 } }),
    ).rejects.toThrow(/模糊/)
    await expect(
      ipc.invoke('settings:update', { background: { ...bg, imagePath: 5 } }),
    ).rejects.toThrow(/背景图片路径/)
  })

  it('tag:create / list / update / remove 与 session-tag:attach / detach 经接口层落到 TagStore；attach 要求会话存在', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session
    const a = (await ipc.invoke('tag:create', 'simba')) as Tag
    const b = (await ipc.invoke('tag:create', 'java', '#D14343')) as Tag
    expect(a).toMatchObject({ name: 'simba', color: '#2F6FDB' })
    expect(b).toMatchObject({ name: 'java', color: '#D14343' })

    await ipc.invoke('session-tag:attach', s.id, a.id)
    await expect(ipc.invoke('session-tag:attach', 'missing', a.id)).rejects.toThrow(
      '会话不存在：missing',
    )
    await expect(ipc.invoke('session-tag:attach', s.id, 'missing')).rejects.toThrow(
      '标签不存在：missing',
    )
    const updated = (await ipc.invoke('tag:update', a.id, { name: 'simba-2' })) as Tag
    expect(updated.name).toBe('simba-2')
    await expect(ipc.invoke('tag:list')).resolves.toEqual({
      tags: [updated, b],
      sessionTags: [{ sessionId: s.id, tagId: a.id }],
    })

    await ipc.invoke('session-tag:detach', s.id, a.id)
    await ipc.invoke('tag:remove', b.id)
    await expect(ipc.invoke('tag:list')).resolves.toEqual({ tags: [updated], sessionTags: [] })
  })

  it('tag 相关非法参数在接口层被拒绝', async () => {
    await expect(ipc.invoke('tag:create', '   ')).rejects.toThrow('标签名不能为空')
    await expect(ipc.invoke('tag:create', 5)).rejects.toThrow('标签名不能为空')
    await expect(ipc.invoke('tag:create', 'x', '#000000')).rejects.toThrow('不支持的颜色：#000000')
    await expect(ipc.invoke('tag:update', '', { name: 'x' })).rejects.toThrow('标签 id 不能为空')
    await expect(ipc.invoke('tag:update', 'id', { name: 7 })).rejects.toThrow('标签名不能为空')
    await expect(ipc.invoke('tag:update', 'id', { color: 'red' })).rejects.toThrow(
      '不支持的颜色：red',
    )
    await expect(ipc.invoke('tag:update', 'id', { sortOrder: 1.5 })).rejects.toThrow(
      '排序值必须是整数',
    )
    await expect(ipc.invoke('tag:remove', 3)).rejects.toThrow('标签 id 不能为空')
    await expect(ipc.invoke('session-tag:attach', 'x', '')).rejects.toThrow('标签 id 不能为空')
    await expect(ipc.invoke('session-tag:detach', '', 'y')).rejects.toThrow('会话 id 不能为空')
  })

  it('session:remove 级联删掉该会话的标签关联（kill pty → 删会话 → 删关联）', async () => {
    const s = (await ipc.invoke('session:create', { cwd: process.cwd() })) as Session
    const a = (await ipc.invoke('tag:create', 'simba')) as Tag
    await ipc.invoke('session-tag:attach', s.id, a.id)

    await ipc.invoke('session:remove', s.id)
    const result = (await ipc.invoke('tag:list')) as TagListResult
    expect(result.sessionTags).toEqual([])
    expect(result.tags).toEqual([a])
  })

  it('session:create 带 tagIds：建会话后逐个 attach；tagIds 非字符串数组被拒绝；含不存在的标签 → reject 但会话已创建（不回滚）', async () => {
    const a = (await ipc.invoke('tag:create', 'simba')) as Tag
    const b = (await ipc.invoke('tag:create', 'java')) as Tag
    const s = (await ipc.invoke('session:create', {
      cwd: process.cwd(),
      tagIds: [a.id, b.id],
    })) as Session
    const result = (await ipc.invoke('tag:list')) as TagListResult
    expect(result.sessionTags).toEqual([
      { sessionId: s.id, tagId: a.id },
      { sessionId: s.id, tagId: b.id },
    ])

    await expect(ipc.invoke('session:create', { cwd: process.cwd(), tagIds: 'x' })).rejects.toThrow(
      '标签 id 列表格式不正确',
    )
    await expect(
      ipc.invoke('session:create', { cwd: process.cwd(), tagIds: [a.id, 5] }),
    ).rejects.toThrow('标签 id 列表格式不正确')

    await expect(
      ipc.invoke('session:create', {
        cwd: process.cwd(),
        name: 'partial',
        tagIds: [a.id, 'ghost'],
      }),
    ).rejects.toThrow('标签不存在：ghost')
    const sessions = (await ipc.invoke('session:list')) as Session[]
    const partial = sessions.find((x) => x.name === 'partial')!
    expect(partial).toBeDefined()
    const after = (await ipc.invoke('tag:list')) as TagListResult
    expect(after.sessionTags).toContainEqual({ sessionId: partial.id, tagId: a.id })
  })
})
