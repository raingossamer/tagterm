/**
 * 装配层：创建各服务、注入依赖、绑定 app 生命周期；不含业务逻辑。
 * 会话生命周期 = 应用生命周期：关窗只隐藏到托盘；托盘「退出」与 before-quit 都 killAll。
 */
import { app, BrowserWindow, dialog, ipcMain, nativeImage, type Tray } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync } from 'node:fs'
import { release, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutoLaunchStatus, EventArgs, EventChannel } from '@shared/ipc'
import { DEFAULT_AGENTS } from '@shared/models'
import { createMainWindow, showMainWindow } from './window'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { hasChildProcesses } from './processTree'
import { runSmokeCheck } from './smoke'
import { SessionStore } from './store/SessionStore'
import { SettingsStore } from './store/SettingsStore'
import { TagStore } from './store/TagStore'
import { resolveDataDir } from './store/paths'
import { PtyManager } from './pty/PtyManager'
import { Updater } from './updater/Updater'
import { detectAvailableShells, findOnPath } from './pathProbe'
import { IMAGE_EXTENSIONS } from './store/backgroundImage'

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
let tray: Tray | null = null
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

function quitApp(): void {
  isQuitting = true
  app.quit()
}

const ptyManager = new PtyManager({
  onData: (sessionId, data) => broadcast('pty:data', sessionId, data),
  onExit: (e) => broadcast('pty:exit', e),
  isFile: existsSync, // spawn 前把 shell 名解析成绝对路径：开机自启时工作目录是 System32，相对名会撞 node-pty 的缺陷
})
console.log('[pty] node-pty 已加载')

// 检查更新：更新源见 electron-builder.yml 的 publish；只提示不自动下载，安装前结束全部终端
const updater = new Updater({
  autoUpdater,
  currentVersion: app.getVersion(),
  onStatus: (status) => broadcast('update:status', status),
  beforeInstall: () => {
    isQuitting = true
    ptyManager.killAll()
  },
})

app.whenReady().then(async () => {
  const dataDir = isSmoke ? app.getPath('userData') : resolveDataDir(app.getPath('appData'))
  const pathEnv = process.env['PATH'] ?? ''
  const availableShells = detectAvailableShells(pathEnv, existsSync)
  const availableAgents = findOnPath(DEFAULT_AGENTS, pathEnv, existsSync)
  console.log(`[main] 可用 shell：${availableShells.join(', ') || '无'}`)
  console.log(`[main] 已安装的唤起工具：${availableAgents.join(', ') || '无'}`)

  const store = new SessionStore(dataDir, {
    onChanged: (sessions) => broadcast('session:changed', sessions),
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
  try {
    await store.load()
    await settings.load()
    await tags.load()
    // 两份文件都加载后再清掉崩溃遗留的悬空关联（此时渲染进程尚未订阅，不广播）
    await tags.pruneDangling(store.list().map((s) => s.id))
  } catch (err) {
    // 坏文件不静默清空：提示后退出，由用户处理文件
    dialog.showErrorBox('TagTerm 无法加载数据', err instanceof Error ? err.message : String(err))
    app.exit(1)
    return
  }

  registerIpc(ipcMain, {
    version: app.getVersion(),
    osBuild: osBuildNumber(),
    store,
    settings,
    tags,
    updater,
    pty: ptyManager,
    dataDir,
    pickDirectory,
    pickImage,
    listShells: () => availableShells,
    hasChildProcesses,
    getAutoLaunch,
    setAutoLaunch,
  })

  if (isHiddenStart) console.log('[main] 隐藏启动（开机自启），窗口留在托盘')
  mainWindow = createMainWindow({
    shouldHideOnClose: () => !isQuitting,
    showOnReady: !isHiddenStart,
  })
  tray = createTray({ onShow: showWindow, onOpenSettings: openSettings, onQuit: quitApp })
  if (isSmoke) runSmokeCheck(mainWindow, { store, tags, pty: ptyManager, quit: quitApp })
  // 未打包（开发）时 electron-updater 会直接报错，只在打包版自动检查
  else if (app.isPackaged) updater.scheduleAutoCheck(10_000)
})

app.on('second-instance', () => showWindow())

// 退出前结束全部终端，防孤儿 conhost（托盘「退出」也走这里）
app.on('before-quit', () => {
  isQuitting = true
  ptyManager.killAll()
  tray?.destroy()
  tray = null
})

// 常驻托盘：关闭窗口不退出
app.on('window-all-closed', () => {
  /* 保持运行，由托盘「退出」结束 */
})
