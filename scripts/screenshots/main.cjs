/**
 * README 截图：用 Electron 打开真实的渲染进程构建产物（out/renderer），后端换成 fake-preload.cjs 里的演示数据，
 * 按场景点开会话、换背景、开弹窗，逐张截图写进 docs/screenshots/，然后退出。
 * 与用户正在运行的 TagTerm 完全隔离：独立 userData、不起 shell、不碰 %APPDATA%\TagTerm 与 ~/.claude / ~/.codex。
 * 用法：pnpm screenshots（先 electron-vite build 出 out/，再跑本脚本）
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'screenshots')
const RENDERER = join(ROOT, 'out', 'renderer', 'index.html')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

// 独立的 userData：localStorage（标签页记忆、折叠状态）从空白开始，也不和正在运行的实例抢单实例锁
const USER_DATA = join(tmpdir(), 'tagterm-screenshots')
rmSync(USER_DATA, { recursive: true, force: true })
app.setPath('userData', USER_DATA)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  ipcMain.handle('demo:get-version', () => VERSION)
  mkdirSync(OUT_DIR, { recursive: true })

  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: '#E9ECF0',
    webPreferences: {
      preload: join(__dirname, 'fake-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const errors = []
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message)
  })

  const js = (code) => win.webContents.executeJavaScript(code)
  const waitFor = async (expr, label, timeoutMs = 10000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await js(`!!(${expr})`)) return
      await sleep(100)
    }
    throw new Error(`等待超时：${label}`)
  }
  const clickRow = (name) =>
    js(
      `[...document.querySelectorAll('[data-test=session-row]')].find((r) => r.querySelector('.name')?.textContent === ${JSON.stringify(name)})?.click()`,
    )
  const shot = async (file) => {
    await sleep(600) // 等过渡动画与终端重绘
    // 窗口被别的窗口完全挡住时合成器没有这一帧，capturePage 抛 UnknownVizError：抬到最前再试几次，不让一次遮挡废掉整轮
    let image
    for (let attempt = 1; ; attempt += 1) {
      try {
        image = await win.webContents.capturePage()
        break
      } catch (err) {
        if (attempt >= 4) throw err
        console.log(
          `[screenshots] ${file} 截图失败（${err instanceof Error ? err.message : err}），重试 ${attempt}`,
        )
        win.show()
        win.moveTop()
        await sleep(700)
      }
    }
    writeFileSync(join(OUT_DIR, file), image.toPNG())
    const { width, height } = image.getSize()
    console.log(`[screenshots] ${file} ${width}×${height}`)
  }

  try {
    await win.loadFile(RENDERER)
    await waitFor(`document.querySelectorAll('[data-test=session-row]').length >= 6`, '会话列表')

    // 1. 主界面：依次打开四个会话成为标签页（各自进入演示状态），最后停在 tagterm
    for (const name of ['simba-api', 'simba-web', 'simba-infra', 'tagterm']) {
      await clickRow(name)
      await sleep(400)
    }
    await waitFor(
      `document.querySelector('[data-test=status-blocked]')?.textContent.includes('1')`,
      '状态点',
    )
    await sleep(800)
    await shot('main.png')

    // 2. 全局背景：一张渐变图铺满整窗，面板半透明
    await js(
      `window.tagterm.settings.update({ background: { imagePath: 'D:\\\\Pictures\\\\wallpaper.jpg', fit: 'cover', imageOpacity: 0.9, panelOpacity: 0.45, blurPx: 0 } })`,
    )
    await waitFor(`document.querySelector('[data-test=app-background]')`, '背景层', 5000).catch(
      () => {},
    )
    await sleep(800)
    await shot('background.png')

    // 3. 设置弹窗（外观段）
    await js(`document.querySelector('[data-test=open-settings]')?.click()`)
    await waitFor(`document.querySelector('[data-test=appearance-section]')`, '设置弹窗')
    await shot('settings.png')
    await js(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    )
    await sleep(300)

    // 4. 管理标签
    await js(`document.querySelector('[data-test=manage-tags]')?.click()`)
    await sleep(500)
    await shot('manage-tags.png')
  } catch (err) {
    console.error('[screenshots] 失败：', err)
    process.exitCode = 1
  }
  if (errors.length) console.log('[screenshots] 渲染进程报错：', errors)
  app.quit()
})
