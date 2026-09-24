import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerIpc, type IpcDeps } from '../../src/main/ipc'
import { SessionStore } from '../../src/main/store/SessionStore'
import { SettingsStore } from '../../src/main/store/SettingsStore'
import { TagStore } from '../../src/main/store/TagStore'
import { Updater } from '../../src/main/updater/Updater'
import { FakeAutoUpdater } from './fakeAutoUpdater'
import { PtyManager } from '../../src/main/pty/PtyManager'
import type { AgentSubsystem } from '../../src/main/agent/AgentSubsystem'
import { SessionSubsystem } from '../../src/main/session/SessionSubsystem'
import { GlobalShortcut } from '../../src/main/shortcut/GlobalShortcut'
import { FakeConpty } from './fakeConpty'
import { FakeShortcutPort } from './fakeShortcutPort'
import type { AutoLaunchStatus, PtyExitEvent, PtyOpenResult, TagListResult } from '@shared/ipc'
import type { Session, SessionRuntime, Settings, Tag, UpdateStatus } from '@shared/models'
import { createFakeIpcMain, type FakeIpcMain } from './fakeIpcMain'
import { createQuietAgent } from './quietAgent'

describe('IPC 接口层', () => {
  let dir: string
  let ipc: FakeIpcMain
  let deps: IpcDeps
  let store: SessionStore
  let settings: SettingsStore
  let tags: TagStore
  let pty: PtyManager
  let agent: AgentSubsystem
  const agentChanges: SessionRuntime[] = []
  const agentRemovals: string[] = []
  let autoUpdater: FakeAutoUpdater
  const updateStatuses: UpdateStatus[] = []
  const exits: PtyExitEvent[] = []
  /** 假 ConPTY：node-pty 是真外部依赖，这里不起真实终端（真实终端的行为见 PtyManager / SessionSubsystem 测试） */
  let conpty: FakeConpty
  /** 假登录项：开机自启状态 */
  let autoLaunch: AutoLaunchStatus = { enabled: false, blockedBySystem: false }
  /** 假打开目录端口（FolderPort）：记下要打开的路径；openPathError 非空即模拟打开失败（返回原因） */
  const opened: string[] = []
  let openPathError = ''
  /** 假的系统热键表：全局快捷键服务注册到这里 */
  let shortcutPort: FakeShortcutPort
  let shortcut: GlobalShortcut
  /** 会话列表广播（session:changed）的次数 */
  let sessionBroadcasts = 0

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-ipc-'))
    store = new SessionStore(dir, { onChanged: () => (sessionBroadcasts += 1) })
    await store.load()
    settings = new SettingsStore(dir, { seedCommands: ['claude', 'pi'] })
    await settings.load()
    tags = new TagStore(dir)
    await tags.load()
    // 与生产同一条装配（PtyManager 的回调经 wrapPty 串上状态机与探针、会话子系统拿它们装配），只换真外部依赖：
    // node-pty 换假 ConPTY；AgentSubsystem 不 start（不起 HookServer，hooks 状态在端口 0 下同样成立）、进程树为空
    agent = createQuietAgent({
      dir,
      sessions: () => store.list(),
      // 记录变化与删除（alive: false 墓碑）走同一条广播
      broadcast: (r) => (r.alive ? agentChanges.push(r) : agentRemovals.push(r.sessionId)),
    })
    conpty = new FakeConpty()
    pty = new PtyManager(
      agent.wrapPty({
        onData: () => {},
        onExit: (e) => exits.push(e),
        isFile: existsSync,
        spawnPty: conpty.spawn,
      }),
    )
    shortcutPort = new FakeShortcutPort()
    shortcut = new GlobalShortcut({ port: shortcutPort, onPress: () => {} })
    shortcut.start(settings.getGlobalShortcut())
    ipc = createFakeIpcMain()
    autoUpdater = new FakeAutoUpdater()
    const updater = new Updater({
      loadAutoUpdater: async () => autoUpdater,
      currentVersion: '0.1.0',
      onStatus: (s) => updateStatuses.push(s),
      beforeInstall: () => autoUpdater.order.push('before'),
    })
    const folders = {
      open: async (path: string): Promise<string | null> => {
        opened.push(path)
        return openPathError || null
      },
    }
    deps = {
      version: '0.1.0',
      osBuild: 26200,
      sessions: new SessionSubsystem({ store, tags, terminals: pty, agent, folders }),
      settings,
      tags,
      updater,
      agent,
      shortcut,
      dataDir: dir,
      logsDir: join(dir, 'logs'),
      pickImage: async () => join(dir, 'picked.png'),
      pickDirectory: async () => 'D:\\picked',
      folders,
      listShells: () => ['cmd.exe', 'powershell.exe'],
      getAutoLaunch: () => autoLaunch,
      setAutoLaunch: (enabled) => {
        autoLaunch = { enabled, blockedBySystem: false }
        return autoLaunch
      },
    }
    registerIpc(ipc, deps)
  })
  afterEach(async () => {
    pty.killAll()
    await agent.stop()
    sessionBroadcasts = 0
    autoLaunch = { enabled: false, blockedBySystem: false }
    opened.length = 0
    openPathError = ''
    exits.length = 0
    agentChanges.length = 0
    agentRemovals.length = 0
    updateStatuses.length = 0
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

  it('session:update 带 startupCmd / sortOrder、tag:update 带 sortOrder 一律忽略：启动命令已不做，排序只走 reorder 通道', async () => {
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    const updated = (await ipc.invoke('session:update', s.id, {
      name: 'n2',
      startupCmd: 'claude',
      sortOrder: 99,
    })) as Session
    expect(updated).toEqual({ ...s, name: 'n2' })
    expect(store.get(s.id)).toEqual({ ...s, name: 'n2' })

    const t = (await ipc.invoke('tag:create', 'simba')) as Tag
    const renamed = (await ipc.invoke('tag:update', t.id, { name: 'simba-2', sortOrder: 9 })) as Tag
    expect(renamed).toEqual({ ...t, name: 'simba-2' })
    // 字段已不认识，类型不对也不再报错
    await expect(ipc.invoke('tag:update', t.id, { sortOrder: 1.5 })).resolves.toEqual(renamed)
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

  it('session:open-directory：渲染进程只传会话 id，交子系统打开会话目录；id 非法在接口层拒绝（路径解析与错误文案见 SessionSubsystem 测试）', async () => {
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    await expect(ipc.invoke('session:open-directory', s.id)).resolves.toBeUndefined()
    expect(opened).toEqual(['D:\\x'])

    await expect(ipc.invoke('session:open-directory', '')).rejects.toThrow('会话 id 不能为空')
    expect(opened).toHaveLength(1)
  })

  it('app:open-logs-dir：日志目录由主进程给定（渲染进程不传路径），不存在先建，再交注入的 openPath；打不开 → reject「打不开日志目录：…」', async () => {
    const logsDir = join(dir, 'logs')
    expect(existsSync(logsDir)).toBe(false)
    await expect(ipc.invoke('app:open-logs-dir')).resolves.toBeUndefined()
    expect(existsSync(logsDir)).toBe(true)
    expect(opened).toEqual([logsDir])

    openPathError = 'Access is denied'
    await expect(ipc.invoke('app:open-logs-dir')).rejects.toThrow(
      '打不开日志目录：Access is denied',
    )
  })

  it('app:list-shells 返回本机可用的 shell', async () => {
    await expect(ipc.invoke('app:list-shells')).resolves.toEqual(['cmd.exe', 'powershell.exe'])
  })

  it('pty:open / write / resize / is-alive / kill 经接口层转给子系统（幂等、不写盘、等退出等规则见 SessionSubsystem 测试）', async () => {
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    const result = (await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })) as PtyOpenResult
    expect(result.created).toBe(true)
    expect(conpty.spawns.map((x) => x.pid)).toEqual([result.pid])
    await expect(ipc.invoke('pty:is-alive', s.id)).resolves.toBe(true)

    ipc.send('pty:write', s.id, 'dir\r')
    await ipc.invoke('pty:resize', s.id, { cols: 100, rows: 30 })
    expect(conpty.writes).toEqual([[result.pid, 'dir\r']])
    expect(conpty.resizes).toEqual([[result.pid, 100, 30]])

    const killing = ipc.invoke('pty:kill', s.id)
    conpty.exit(result.pid)
    await killing
    expect(exits.map((e) => e.sessionId)).toEqual([s.id])
    await expect(ipc.invoke('pty:is-alive', s.id)).resolves.toBe(false)
  })

  it('session:update 的 cwd 在接口层 trim、不能为空', async () => {
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    const moved = (await ipc.invoke('session:update', s.id, { cwd: ' D:\\y ' })) as Session
    expect(moved.cwd).toBe('D:\\y')
    expect(store.get(s.id).cwd).toBe('D:\\y')
    await expect(ipc.invoke('session:update', s.id, { cwd: '   ' })).rejects.toThrow('需要一个目录')
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

  it('app:get-global-shortcut 返回全局快捷键状态（缺省开启 + Ctrl+Alt+T，已注册）', async () => {
    await expect(ipc.invoke('app:get-global-shortcut')).resolves.toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+T',
      registered: true,
    })
  })

  it('app:set-global-shortcut：先注册新键位，成功才落盘（settings:changed 带上它）并返回新状态；被占用 reject、旧键位照旧、不落盘', async () => {
    await expect(
      ipc.invoke('app:set-global-shortcut', { enabled: true, accelerator: 'Ctrl+Alt+Y' }),
    ).resolves.toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Y', registered: true })
    expect([...shortcutPort.registered.keys()]).toEqual(['Ctrl+Alt+Y'])
    expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Y' })

    shortcutPort.occupied.add('Alt+F9')
    await expect(
      ipc.invoke('app:set-global-shortcut', { enabled: true, accelerator: 'Alt+F9' }),
    ).rejects.toThrow('该快捷键已被其他程序占用')
    expect([...shortcutPort.registered.keys()]).toEqual(['Ctrl+Alt+Y'])
    expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Y' })

    await expect(
      ipc.invoke('app:set-global-shortcut', { enabled: false, accelerator: 'Ctrl+Alt+Y' }),
    ).resolves.toEqual({ enabled: false, accelerator: 'Ctrl+Alt+Y', registered: false })
    expect(shortcutPort.registered.size).toBe(0)
  })

  it('app:set-global-shortcut 落盘失败：系统注册、状态与内存里的设置都回到调用前，之后别的变更落盘也不带上新键位', async () => {
    const file = join(dir, 'settings.json')
    const setWithReadonlyFile = async (accelerator: string) => {
      chmodSync(file, 0o444) // 只读：原子写最后一步 rename 覆盖它时 EPERM，原内容保留
      try {
        await expect(
          ipc.invoke('app:set-global-shortcut', { enabled: true, accelerator }),
        ).rejects.toThrow(/EPERM/)
      } finally {
        chmodSync(file, 0o666)
      }
    }

    await setWithReadonlyFile('Ctrl+Alt+Y')
    expect([...shortcutPort.registered.keys()]).toEqual(['Ctrl+Alt+T'])
    await expect(ipc.invoke('app:get-global-shortcut')).resolves.toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+T',
      registered: true,
    })
    expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+T' })
    await ipc.invoke('settings:update', { launchCommands: [] })
    expect('globalShortcut' in JSON.parse(readFileSync(file, 'utf8'))).toBe(false)

    // 旧键位启动时就被别的程序占着（没注册上）：回滚后同样是「旧键位、没注册上」，新键位不留在系统里
    shortcut.dispose()
    shortcutPort.occupied.add('Ctrl+Alt+T')
    shortcut.start(settings.getGlobalShortcut())
    await setWithReadonlyFile('Ctrl+Alt+Y')
    expect(shortcutPort.registered.size).toBe(0)
    await expect(ipc.invoke('app:get-global-shortcut')).resolves.toEqual({
      enabled: true,
      accelerator: 'Ctrl+Alt+T',
      registered: false,
    })
  })

  it('app:set-global-shortcut 守卫：键位串不合法 / enabled 不是布尔 / 不是对象 → reject，不注册不落盘', async () => {
    for (const bad of [
      { enabled: true, accelerator: 'Shift+T' },
      { enabled: 'yes', accelerator: 'Ctrl+Alt+Y' },
      'Ctrl+Alt+Y',
      null,
    ])
      await expect(ipc.invoke('app:set-global-shortcut', bad)).rejects.toThrow(
        '快捷键设置格式不正确',
      )
    expect([...shortcutPort.registered.keys()]).toEqual(['Ctrl+Alt+T'])
    expect(settings.get().globalShortcut).toBeUndefined()
  })

  it('settings:update 不接受 globalShortcut（只能走专用通道，保证落盘的键位一定注册过）', async () => {
    await ipc.invoke('settings:update', {
      launchCommands: [],
      globalShortcut: { enabled: false, accelerator: 'Ctrl+Alt+Y' },
    })
    expect(settings.getGlobalShortcut()).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+T' })
  })

  it('app:pause-global-shortcut：true 暂停（录新键位期间）、false 恢复；非布尔被拒绝', async () => {
    await ipc.invoke('app:pause-global-shortcut', true)
    expect(shortcutPort.registered.size).toBe(0)
    await ipc.invoke('app:pause-global-shortcut', false)
    expect([...shortcutPort.registered.keys()]).toEqual(['Ctrl+Alt+T'])
    await expect(ipc.invoke('app:pause-global-shortcut', 'yes')).rejects.toThrow(
      '暂停参数必须是布尔',
    )
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

  it('settings:read-background-image：未设置或文件不存在返回 null，存在则返回 MIME 与原始字节（渲染进程自己建 Blob URL）', async () => {
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
    const image = (await ipc.invoke('settings:read-background-image')) as {
      mime: string
      bytes: Uint8Array
    }
    expect(image.mime).toBe('image/png')
    expect(Buffer.from(image.bytes).toString('hex')).toBe('89504e470d0a1a0a')
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

  it('tag:create / list / update / remove 落到 TagStore，session-tag:attach / detach 经会话子系统（挂标签核对会话见 SessionSubsystem 测试）', async () => {
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    const a = (await ipc.invoke('tag:create', 'simba')) as Tag
    const b = (await ipc.invoke('tag:create', 'java', '#D14343')) as Tag
    expect(a).toMatchObject({ name: 'simba', color: '#2F6FDB' })
    expect(b).toMatchObject({ name: 'java', color: '#D14343' })

    await ipc.invoke('session-tag:attach', s.id, a.id)
    await expect(ipc.invoke('session-tag:attach', s.id, 'missing')).rejects.toThrow(
      '标签不存在：missing',
    )
    const updated = (await ipc.invoke('tag:update', a.id, { name: 'simba-2' })) as Tag
    expect(updated.name).toBe('simba-2')
    await expect(ipc.invoke('tag:list')).resolves.toEqual({
      tags: [updated, b],
      sessionTags: [{ sessionId: s.id, tagId: a.id }],
    })

    // reorder：把 b 排到 a 前面，sortOrder 重写为 1..n
    await ipc.invoke('tag:reorder', [b.id, a.id])
    const reordered = (await ipc.invoke('tag:list')) as { tags: Tag[] }
    expect(reordered.tags.map((t) => [t.name, t.sortOrder])).toEqual([
      ['java', 1],
      ['simba-2', 2],
    ])

    await ipc.invoke('session-tag:detach', s.id, a.id)
    await ipc.invoke('tag:remove', b.id)
    const finalList = (await ipc.invoke('tag:list')) as TagListResult
    expect(finalList.sessionTags).toEqual([])
    expect(finalList.tags.map((t) => t.name)).toEqual(['simba-2'])
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
    await expect(ipc.invoke('tag:update', 'id', { hidden: 'yes' })).rejects.toThrow(
      'hidden 必须是布尔值',
    )
    await expect(ipc.invoke('tag:reorder', 'nope')).rejects.toThrow('标签 id 列表格式不正确')
    await expect(ipc.invoke('tag:reorder', ['a', ''])).rejects.toThrow('标签 id 列表格式不正确')
    await expect(ipc.invoke('tag:remove', 3)).rejects.toThrow('标签 id 不能为空')
    await expect(ipc.invoke('session-tag:attach', 'x', '')).rejects.toThrow('标签 id 不能为空')
    await expect(ipc.invoke('session-tag:detach', '', 'y')).rejects.toThrow('会话 id 不能为空')
  })

  it('session:reorder 按 ids 重写 sortOrder 为 1..n；非字符串数组在接口层被拒绝', async () => {
    const a = (await ipc.invoke('session:create', { cwd: process.cwd(), name: 'a' })) as Session
    const b = (await ipc.invoke('session:create', { cwd: process.cwd(), name: 'b' })) as Session

    await ipc.invoke('session:reorder', [b.id, a.id])
    const list = (await ipc.invoke('session:list')) as Session[]
    expect(list.map((s) => [s.name, s.sortOrder])).toEqual([
      ['b', 1],
      ['a', 2],
    ])

    // 类型守卫在接口层，排列是否合法交给 SessionStore 判定
    await expect(ipc.invoke('session:reorder', 'nope')).rejects.toThrow('会话 id 列表格式不正确')
    await expect(ipc.invoke('session:reorder', ['a', ''])).rejects.toThrow('会话 id 列表格式不正确')
    await expect(ipc.invoke('session:reorder', [a.id])).rejects.toThrow(
      '排序参数必须是全部会话 id 的一个排列',
    )
  })

  it('agent:list 转发运行时记录：经同一条装配，pty:open 后出现空闲记录（移除即清见 SessionSubsystem 测试）', async () => {
    await expect(ipc.invoke('agent:list')).resolves.toEqual([])
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })
    await expect(ipc.invoke('agent:list')).resolves.toEqual([
      { sessionId: s.id, alive: true, agent: null, status: 'idle' },
    ])
  })

  it('agent:report-output（单向）：合法报告交子系统（cwdNow 更新）；非法参数在接口层静默忽略（未知会话的过滤见 SessionSubsystem 测试）', async () => {
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x' })) as Session
    await ipc.invoke('pty:open', s.id, { cols: 80, rows: 24 })
    agentChanges.length = 0

    ipc.send('agent:report-output', s.id, { tail: ['C:\\Windows>'], silentMs: 1500 })
    expect(agentChanges.at(-1)).toMatchObject({ sessionId: s.id, cwdNow: 'C:\\Windows' })

    const count = agentChanges.length
    ipc.send('agent:report-output', s.id, { tail: 'C:\\x>', silentMs: 1500 })
    ipc.send('agent:report-output', s.id, { tail: ['C:\\x>'], silentMs: -1 })
    ipc.send('agent:report-output', s.id, { tail: new Array(51).fill('C:\\x>'), silentMs: 0 })
    ipc.send('agent:report-output', 5, { tail: ['C:\\x>'], silentMs: 0 })
    expect(agentChanges).toHaveLength(count)
  })

  it('agent:get-hooks-status / agent:set-hooks 转调子系统（安装 / 卸载往返见 AgentSubsystem 测试）；agent 非 claude / codex 或 enabled 非布尔拒绝', async () => {
    const claudeFile = join(dir, 'claude-settings.json')
    writeFileSync(claudeFile, JSON.stringify({ model: 'opus' }))
    await expect(ipc.invoke('agent:get-hooks-status')).resolves.toEqual({
      claude: { installed: false, port: agent.port, settingsPath: claudeFile },
      codex: { installed: false, port: agent.port, settingsPath: join(dir, 'codex-hooks.json') },
    })
    await expect(ipc.invoke('agent:set-hooks', 'codex', true)).resolves.toMatchObject({
      installed: true,
      port: agent.port,
    })

    await expect(ipc.invoke('agent:set-hooks', 'gemini', true)).rejects.toThrow(
      'hooks 目标只能是 claude 或 codex',
    )
    await expect(ipc.invoke('agent:set-hooks', 'claude', 'yes')).rejects.toThrow(
      'hooks 开关参数必须是布尔',
    )
  })

  it('agent:set-viewed 接受 null 与非空字符串，其余拒绝', async () => {
    await expect(ipc.invoke('agent:set-viewed', null)).resolves.toBeUndefined()
    await expect(ipc.invoke('agent:set-viewed', 'abc')).resolves.toBeUndefined()
    await expect(ipc.invoke('agent:set-viewed', '')).rejects.toThrow(
      '会话 id 必须是非空字符串或 null',
    )
    await expect(ipc.invoke('agent:set-viewed', 5)).rejects.toThrow(
      '会话 id 必须是非空字符串或 null',
    )
    await expect(ipc.invoke('agent:set-viewed', undefined)).rejects.toThrow(
      '会话 id 必须是非空字符串或 null',
    )
  })

  it('session:create 带 tagIds 经子系统逐个挂上；tagIds 不是字符串数组在接口层拒绝（挂标签的顺序与失败不回滚见 SessionSubsystem 测试）', async () => {
    const a = (await ipc.invoke('tag:create', 'simba')) as Tag
    const s = (await ipc.invoke('session:create', { cwd: 'D:\\x', tagIds: [a.id] })) as Session
    const result = (await ipc.invoke('tag:list')) as TagListResult
    expect(result.sessionTags).toEqual([{ sessionId: s.id, tagId: a.id }])

    await expect(ipc.invoke('session:create', { cwd: 'D:\\x', tagIds: 'x' })).rejects.toThrow(
      '标签 id 列表格式不正确',
    )
    await expect(ipc.invoke('session:create', { cwd: 'D:\\x', tagIds: [a.id, 5] })).rejects.toThrow(
      '标签 id 列表格式不正确',
    )
    await expect(ipc.invoke('session:list')).resolves.toHaveLength(1)
  })
})
