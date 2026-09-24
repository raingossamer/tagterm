/**
 * 装配层：创建各服务、造 Electron 适配器、把依赖注入进去、绑定 app 生命周期；业务规则都在服务层
 *（agent 子系统含状态机、hooks、通知去重与角标计数），这里只接线一次。
 * 会话生命周期 = 应用生命周期：关窗只隐藏到托盘；托盘「退出」与 before-quit 都 killAll。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync } from 'node:fs'
import { release, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutoLaunchStatus, EventArgs, EventChannel } from '@shared/ipc'
import { DEFAULT_AGENTS } from '@shared/models'
import overlayBlockedIconPath from '../../resources/overlay-blocked.png?asset'
import overlayDoneIconPath from '../../resources/overlay-done.png?asset'
import overlayWorkingIconPath from '../../resources/overlay-working.png?asset'
import { createMainWindow, showMainWindow } from './window'
import { createTray, type TrayHandle } from './tray'
import { registerIpc } from './ipc'
import { runSmokeCheck } from './smoke'
import { SessionStore } from './store/SessionStore'
import { SettingsStore } from './store/SettingsStore'
import { TagStore } from './store/TagStore'
import { resolveDataDir } from './store/paths'
import { PtyManager } from './pty/PtyManager'
import type { AgentSubsystem } from './agent/AgentSubsystem'
import { createProductionAgent } from './agent/production'
import { electronBadge, electronNotifications } from './platform/agentPorts'
import { electronFolders } from './platform/folderPort'
import { electronShortcuts } from './platform/shortcutPort'
import { SessionSubsystem } from './session/SessionSubsystem'
import { GlobalShortcut } from './shortcut/GlobalShortcut'
import { decideSummon } from './shortcut/summon'
import { Updater } from './updater/Updater'
import { detectAvailableShells, findOnPath } from './pathProbe'
import { IMAGE_EXTENSIONS } from './store/backgroundImage'
import { LogFile } from './log/LogFile'
import { teeConsole } from './log/consoleTee'

// 日志落文件：控制台照常输出，同时抄一份进 <数据目录>\logs\main.log（1 MB 轮转、保留 3 份）；
// 数据目录在 whenReady 里才解析出来，在那之前的日志先缓冲。只收事件与错误，终端输出与键入内容从不经过 console
const logFile = new LogFile({ maxBytes: 1024 * 1024, keep: 3 })
teeConsole(console, (level, message) => logFile.write(level, message))

// 顶层异常：记录日志 + 弹框，不静默
process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常', err)
  dialog.showErrorBox('TagTerm 出错', err?.stack ?? String(err))
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝', reason)
})

// 烟测实例与用户正在运行的实例隔离：独立 userData（单实例锁以此为键）与独立数据目录，不碰真实 sessions.json
const isSmoke = !!process.env['TAGTERM_SMOKE']
if (isSmoke) app.setPath('userData', join(tmpdir(), 'tagterm-smoke'))

// 单实例锁：二次启动只聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let tray: TrayHandle | null = null
/** 终端与 agent 子系统都在 whenReady 里装配（数据目录与会话列表就位之后） */
let ptyManager: PtyManager | null = null
let agent: AgentSubsystem | null = null
/** 任务栏 overlay 的黄点 / 蓝点 / 绿点图，whenReady 里加载 */
let overlayImages: {
  blocked: Electron.NativeImage
  done: Electron.NativeImage
  working: Electron.NativeImage
} | null = null
let isQuitting = false

/** 主进程是持久数据与终端输出的来源：向渲染进程广播 */
function broadcast<K extends EventChannel>(channel: K, ...args: EventArgs<K>): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

async function pickDirectory(): Promise<string | null> {
  const options = { title: '选择会话目录', properties: ['openDirectory' as const] }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function pickImage(): Promise<string | null> {
  const options = {
    title: '选择终端背景图片',
    properties: ['openFile' as const],
    filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

// 开机自启：登录项 = 当前可执行文件 + --hidden（静默进托盘）；读写都用同一组 path / args，否则 openAtLogin 对不上
const AUTO_LAUNCH_ARGS = ['--hidden']
const isHiddenStart = app.commandLine.hasSwitch('hidden')

function loginItemOptions(): { path: string; args: string[] } {
  return { path: process.execPath, args: AUTO_LAUNCH_ARGS }
}

/** 登录项当前状态；未打包（electron.exe）恒为关，避免把开发用的 Electron 登记进启动项 */
function getAutoLaunch(): AutoLaunchStatus {
  if (!app.isPackaged) return { enabled: false, blockedBySystem: false }
  const s = app.getLoginItemSettings(loginItemOptions())
  return {
    enabled: s.openAtLogin,
    blockedBySystem: s.openAtLogin && !s.executableWillLaunchAtLogin,
  }
}

function setAutoLaunch(enabled: boolean): AutoLaunchStatus {
  if (!app.isPackaged) throw new Error('开发模式下不能设置开机自启')
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() })
  console.log(`[main] 开机自启 ${enabled ? '已开启' : '已关闭'}`)
  return getAutoLaunch()
}

/**
 * 背景图缩放（服务层不 import electron，故在这里包成回调注入）：
 * 最长边超过 maxEdge 才缩；照片类按 JPEG 重编码（PNG 无损会把体积放大），其余保持 PNG 以留住透明通道。
 */
function shrinkImage(
  bytes: Buffer,
  maxEdge: number,
  mime: string,
): { bytes: Buffer; mime: string } | null {
  const image = nativeImage.createFromBuffer(bytes)
  const { width, height } = image.getSize()
  const longest = Math.max(width, height)
  if (longest === 0 || longest <= maxEdge) return null
  const resized =
    width >= height
      ? image.resize({ width: maxEdge, quality: 'good' })
      : image.resize({ height: maxEdge, quality: 'good' })
  return mime === 'image/jpeg' || mime === 'image/bmp'
    ? { bytes: resized.toJPEG(90), mime: 'image/jpeg' }
    : { bytes: resized.toPNG(), mime: 'image/png' }
}

/** 托盘「设置」：显示窗口并让渲染进程打开设置弹窗 */
function openSettings(): void {
  showWindow()
  broadcast('app:open-settings')
}

/** Windows 构建号：os.release() 形如 "10.0.26200" */
function osBuildNumber(): number {
  return Number(release().split('.')[2] ?? 0) || 0
}

function showWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) showMainWindow(mainWindow)
}

/**
 * 全局快捷键按下：窗口在前台就藏到托盘，否则还原、显示、聚焦，并让渲染进程把焦点交给当前终端（可直接打字）
 */
function summonWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const action = decideSummon({
    isVisible: mainWindow.isVisible(),
    isMinimized: mainWindow.isMinimized(),
    isFocused: mainWindow.isFocused(),
  })
  if (action === 'hide') {
    mainWindow.hide()
    return
  }
  showMainWindow(mainWindow)
  broadcast('app:focus-terminal')
}

// 全局快捷键（唤出 / 隐藏窗口）：烟测实例不碰系统热键（dryRun），见 platform/shortcutPort
const shortcut = new GlobalShortcut({
  port: electronShortcuts({ dryRun: isSmoke }),
  onPress: summonWindow,
})

function quitApp(): void {
  isQuitting = true
  app.quit()
}

// 检查更新：更新源见 electron-builder.yml 的 publish；只提示不自动下载，安装前结束全部终端
const updater = new Updater({
  autoUpdater,
  currentVersion: app.getVersion(),
  onStatus: (status) => broadcast('update:status', status),
  beforeInstall: () => {
    isQuitting = true
    ptyManager?.killAll()
  },
})

app.whenReady().then(async () => {
  // 系统通知在 Windows 上要有 AppUserModelId（与 electron-builder.yml 的 appId 一致）才能显示
  app.setAppUserModelId('com.tagterm.app')
  overlayImages = {
    blocked: nativeImage.createFromPath(overlayBlockedIconPath),
    done: nativeImage.createFromPath(overlayDoneIconPath),
    working: nativeImage.createFromPath(overlayWorkingIconPath),
  }
  const dataDir = isSmoke ? app.getPath('userData') : resolveDataDir(app.getPath('appData'))
  const logsDir = join(dataDir, 'logs')
  logFile.open(logsDir)
  console.log(`[main] TagTerm v${app.getVersion()} 启动${isSmoke ? '（烟测）' : ''}`)
  const pathEnv = process.env['PATH'] ?? ''
  const availableShells = detectAvailableShells(pathEnv, existsSync)
  const availableAgents = findOnPath(DEFAULT_AGENTS, pathEnv, existsSync)
  console.log(`[main] 可用 shell：${availableShells.join(', ') || '无'}`)
  console.log(`[main] 已安装的唤起工具：${availableAgents.join(', ') || '无'}`)

  const store = new SessionStore(dataDir, {
    onChanged: (list) => broadcast('session:changed', list),
  })
  // 首次运行时 settings.json 的唤起命令来自 PATH 探测；之后完全以文件为准
  const settings = new SettingsStore(dataDir, {
    seedCommands: availableAgents,
    onChanged: (next) => broadcast('settings:changed', next),
    shrinkImage,
  })
  const tags = new TagStore(dataDir, {
    onChanged: (result) => broadcast('tag:changed', result),
  })

  // agent 运行时子系统：状态机 / 进程树 / hooks 端点与安装器 / 通知 / 角标全在里面，这里只造 Electron 适配器并接线一次；
  // PtyManager 的三个回调经 wrapPty 串上状态机与探针。两者的构造都不做 I/O（端点在 start 才起），
  // 所以能排在数据加载之前 —— 会话子系统要拿它们装配；往这些构造函数里加 I/O 会改变加载失败时的行为
  const subsystem = createProductionAgent({
    dataDir,
    isSmoke, // hooks 目标隔离到数据目录下的假主目录：烟测的端口同步绝不能碰用户真实的 ~/.claude / ~/.codex
    sessions: () => store.list(),
    broadcast: (runtime) => broadcast('agent:status', runtime),
    notifications: electronNotifications({
      silent: isSmoke, // 烟测不弹（避免往通知中心堆 toast）
      onClick: (sessionId) => {
        showWindow()
        broadcast('app:select-session', sessionId)
      },
    }),
    badge: electronBadge({
      tray: () => tray,
      window: () => mainWindow,
      overlays: overlayImages!,
    }),
  })
  const pty = new PtyManager(
    subsystem.wrapPty({
      onData: (sessionId, data) => broadcast('pty:data', sessionId, data),
      onExit: (e) => broadcast('pty:exit', e),
      isFile: existsSync, // spawn 前把 shell 名解析成绝对路径：开机自启时工作目录是 System32，相对名会撞 node-pty 的缺陷
    }),
  )
  console.log('[pty] node-pty 已加载')
  // 会话编排子系统：会话记录 / 标签关联 / 终端 / 运行时记录之间的因果都在里面，启动加载顺序也归它
  const folders = electronFolders()
  const sessions = new SessionSubsystem({
    store,
    tags,
    terminals: pty,
    agent: subsystem,
    folders,
  })
  try {
    // sessions.json → tags.json → 清掉崩溃遗留的悬空关联（此时渲染进程尚未订阅，不广播），再加载设置
    await sessions.load()
    await settings.load()
  } catch (err) {
    // 坏文件不静默清空：提示后退出，由用户处理文件
    dialog.showErrorBox('TagTerm 无法加载数据', err instanceof Error ? err.message : String(err))
    app.exit(1)
    return
  }
  agent = subsystem
  ptyManager = pty
  await subsystem.start()

  registerIpc(ipcMain, {
    version: app.getVersion(),
    osBuild: osBuildNumber(),
    sessions,
    settings,
    tags,
    updater,
    agent: subsystem,
    shortcut,
    dataDir,
    logsDir,
    pickDirectory,
    folders, // 「打开日志目录」：与会话子系统的「打开目录」共用同一个 shell.openPath 适配器
    pickImage,
    listShells: () => availableShells,
    getAutoLaunch,
    setAutoLaunch,
  })

  if (isHiddenStart) console.log('[main] 隐藏启动（开机自启），窗口留在托盘')
  // 不装菜单：Electron 默认菜单的隐藏快捷键（Ctrl+R 重载界面、Ctrl+= 整窗缩放、Ctrl+W 关窗、单按 Alt 冒菜单栏）
  // 与终端和字号调节相冲突；输入框的复制粘贴是 Chromium 自带的编辑命令，不依赖菜单。开发模式用 F12 开开发者工具
  Menu.setApplicationMenu(null)
  mainWindow = createMainWindow({
    shouldHideOnClose: () => !isQuitting,
    showOnReady: !isHiddenStart,
    isDevToolsKeyEnabled: !app.isPackaged,
  })
  // 渲染进程的警告与错误也进日志（主进程监听窗口的控制台消息，不新增通道）；普通 log 不收
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error')
      logFile.write(event.level === 'error' ? 'ERROR' : 'WARN', `[renderer] ${event.message}`)
  })
  tray = createTray({ onShow: showWindow, onOpenSettings: openSettings, onQuit: quitApp })
  // 窗口就绪后再注册：按下时要操作它；被别的程序占着只记日志，设置「启动」段显示红字
  shortcut.start(settings.getGlobalShortcut())
  if (isSmoke)
    runSmokeCheck(mainWindow, {
      sessions,
      tags,
      pty,
      agent: subsystem,
      badgeCounts: () => tray?.counts() ?? null,
      summon: summonWindow,
      quit: quitApp,
    })
  // 未打包（开发）时 electron-updater 会直接报错，只在打包版自动检查
  else if (app.isPackaged) updater.scheduleAutoCheck(10_000)
})

app.on('second-instance', () => showWindow())

// 退出前结束全部终端，防孤儿 conhost（托盘「退出」也走这里）
app.on('before-quit', () => {
  isQuitting = true
  ptyManager?.killAll()
  shortcut.dispose()
  void agent?.stop()
  agent = null
  tray?.destroy()
  tray = null
})

// 常驻托盘：关闭窗口不退出
app.on('window-all-closed', () => {
  /* 保持运行，由托盘「退出」结束 */
})
