/**
 * README 截图用的假后端：在 preload 里按 TagTermApi 的形状实现一份内存版 window.tagterm，
 * 渲染进程（out/renderer 的真实构建产物）照常运行，只是会话 / 标签 / 设置 / agent 状态 / 终端输出都来自下面的演示数据。
 * 不起真实 shell、不读写任何用户文件、不碰 hooks —— 截图里只可能出现这里写死的内容。
 * 运行在 sandbox: true 下，只用 contextBridge / ipcRenderer。
 */
const { contextBridge, ipcRenderer } = require('electron')

// ---- 演示数据 ----

const T0 = '2026-09-01T09:00:00.000Z'

let tags = [
  { id: 't-simba', name: 'simba', color: '#7B4FD1', sortOrder: 1 },
  { id: 't-ops', name: '运维', color: '#D14343', sortOrder: 2 },
  { id: 't-oss', name: '开源', color: '#1E9BA8', sortOrder: 3 },
  { id: 't-tools', name: '工具', color: '#C8449A', sortOrder: 4 },
]

let sessions = [
  ['s-api', 'simba-api', 'D:\\Projects\\simba\\api'],
  ['s-web', 'simba-web', 'D:\\Projects\\simba\\web'],
  ['s-infra', 'simba-infra', 'D:\\Projects\\simba\\infra'],
  ['s-tagterm', 'tagterm', 'D:\\Projects\\oss\\tagterm'],
  ['s-dotfiles', 'dotfiles', 'D:\\Projects\\oss\\dotfiles'],
  ['s-notes', 'notes', 'D:\\Notes'],
].map(([id, name, cwd], i) => ({
  id,
  name,
  cwd,
  shell: 'cmd.exe',
  sortOrder: i + 1,
  createdAt: T0,
}))

let sessionTags = [
  ['s-api', 't-simba'],
  ['s-web', 't-simba'],
  ['s-infra', 't-simba'],
  ['s-infra', 't-ops'],
  ['s-tagterm', 't-oss'],
  ['s-tagterm', 't-tools'],
  ['s-dotfiles', 't-tools'],
].map(([sessionId, tagId]) => ({ sessionId, tagId }))

let settings = {
  launchCommands: [
    { id: 'c-claude', label: 'claude', command: 'claude', pinned: true, sortOrder: 1 },
    { id: 'c-codex', label: 'codex', command: 'codex', pinned: true, sortOrder: 2 },
    { id: 'c-gemini', label: 'gemini', command: 'gemini', pinned: true, sortOrder: 3 },
    { id: 'c-pi', label: 'pi', command: 'pi', pinned: false, sortOrder: 4 },
  ],
  background: {
    imagePath: null,
    fit: 'contain',
    imageOpacity: 0.35,
    panelOpacity: 0.75,
    blurPx: 4,
  },
}

/** 终端打开后各会话处于什么状态（真实应用里由进程树 / hooks / 屏幕判定给出） */
const DEMO_RUNTIME = {
  's-api': { agent: 'claude', status: 'working' },
  's-web': {
    agent: 'claude',
    status: 'blocked',
    pendingHint: 'Claude needs your permission to use Bash',
  },
  's-infra': { agent: 'codex', status: 'done' },
}

const ESC = '\x1b['
const c = (code, text) => `${ESC}${code}m${text}${ESC}0m`
const BANNER =
  'Microsoft Windows [版本 10.0.26100.4652]\r\n(c) Microsoft Corporation。保留所有权利。\r\n\r\n'
const promptOf = (id) => `${sessions.find((s) => s.id === id).cwd}>`

/** 各会话终端里的演示输出（cmd 风格；只有当前页可见） */
function transcriptOf(id) {
  const p = promptOf(id)
  if (id === 's-tagterm') {
    const ok = (project, file, count, ms) =>
      ` ${c(32, '✓')} ${c(project === 'main' ? '44;30' : '45;30', ` ${project} `)} ${file} ${c(2, `(${count} tests)`)} ${c(33, `${ms}ms`)}\r\n`
    return [
      BANNER,
      `${p}git status -sb\r\n`,
      `## ${c(32, 'main')}...${c(31, 'origin/main')}\r\n`,
      ` ${c(31, 'M')} README.md\r\n`,
      `${c(31, '??')} docs/screenshots/\r\n\r\n`,
      `${p}pnpm test\r\n\r\n`,
      ` ${c('46;30', ' RUN ')} ${c(36, 'v4.0.8 ')}${c(2, 'D:/Projects/oss/tagterm')}\r\n\r\n`,
      ok('main', 'tests/main/AgentDetector.test.ts', 52, 64),
      ok('main', 'tests/main/hookContract.test.ts', 4, 41),
      ok('main', 'tests/main/HookInstaller.test.ts', 5, 88),
      ok('main', 'tests/main/PtyManager.test.ts', 9, 2104),
      ok('main', 'tests/main/trayMenu.test.ts', 12, 17),
      ok('renderer', 'tests/renderer/components/PathStrip.test.ts', 11, 212),
      ok('renderer', 'tests/renderer/components/SessionGroups.test.ts', 16, 305),
      ok('renderer', 'tests/renderer/terminal/TerminalWorkspace.test.ts', 27, 96),
      `   ${c(2, '… 另 54 个文件')}\r\n\r\n`,
      `${c(2, ' Test Files ')} ${c('1;32', '62 passed')} ${c(2, '(62)')}\r\n`,
      `${c(2, '      Tests ')} ${c('1;32', '334 passed')} ${c(2, '(334)')}\r\n`,
      `${c(2, '   Duration ')} 16.69s\r\n\r\n`,
      p,
    ].join('')
  }
  const launched = { 's-api': 'claude', 's-web': 'claude', 's-infra': 'codex' }[id]
  return launched ? `${BANNER}${p}${launched}\r\n` : `${BANNER}${p}`
}

/**
 * 设置「外观」的演示背景：一张柔和的渐变 SVG，base64 data: URL（与主进程读图后给的形式一致；
 * 不能用 encodeURIComponent —— 它不转义 SVG 里 url(#g) 的括号，放进不带引号的 CSS url() 会被整条丢弃）
 */
const WALLPAPER = `data:image/svg+xml;base64,${btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#cfe8f3"/><stop offset="0.5" stop-color="#e6ddf7"/><stop offset="1" stop-color="#fbe3d4"/>
    </linearGradient>
    <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#g)"/>
  <g filter="url(#b)" opacity="0.85">
    <circle cx="260" cy="220" r="260" fill="#6ec3d8"/>
    <circle cx="1240" cy="180" r="240" fill="#a78bda"/>
    <circle cx="980" cy="820" r="300" fill="#f5a97f"/>
    <circle cx="420" cy="860" r="220" fill="#8fd3b0"/>
  </g>
</svg>`)}`

// ---- 事件总线 ----

const bus = {}
const on = (channel) => (cb) => {
  ;(bus[channel] ??= new Set()).add(cb)
  return () => bus[channel].delete(cb)
}
const emit = (channel, ...args) => {
  for (const cb of [...(bus[channel] ?? [])]) cb(...args)
}
const clone = (v) => JSON.parse(JSON.stringify(v))
const ok = (v) => Promise.resolve(v === undefined ? undefined : clone(v))

// ---- 运行时（打开终端后才有记录，与真实应用一致） ----

const runtime = new Map()
let nextPid = 4200

function setRuntime(sessionId) {
  const next = { sessionId, alive: true, agent: null, status: 'idle', ...DEMO_RUNTIME[sessionId] }
  runtime.set(sessionId, next)
  emit('agent:status', clone(next))
}

const hooks = (installed) => ({
  claude: { installed, port: 56504, settingsPath: 'C:\\Users\\demo\\.claude\\settings.json' },
  codex: { installed: false, port: 56504, settingsPath: 'C:\\Users\\demo\\.codex\\hooks.json' },
})

const tagResult = () => ({ tags, sessionTags })

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('demo:get-version'),
    getOsBuild: () => ok(26100),
    listShells: () => ok(['cmd.exe', 'powershell.exe', 'pwsh.exe']),
    getDataDir: () => ok('C:\\Users\\demo\\AppData\\Roaming\\TagTerm'),
    pickImage: () => ok(null),
    getAutoLaunch: () => ok({ enabled: true, blockedBySystem: false }),
    setAutoLaunch: (enabled) => ok({ enabled, blockedBySystem: false }),
    onOpenSettings: on('app:open-settings'),
    onSelectSession: on('app:select-session'),
  },
  session: {
    list: () => ok(sessions),
    create: (input) => {
      const s = {
        id: `s-${Date.now()}`,
        name: input.name || input.cwd.split('\\').pop(),
        cwd: input.cwd,
        shell: input.shell ?? 'cmd.exe',
        sortOrder: sessions.length + 1,
        createdAt: T0,
      }
      sessions = [...sessions, s]
      emit('session:changed', clone(sessions))
      return ok(s)
    },
    update: (id, patch) => {
      sessions = sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
      emit('session:changed', clone(sessions))
      return ok(sessions.find((s) => s.id === id))
    },
    remove: (id) => {
      sessions = sessions.filter((s) => s.id !== id)
      emit('session:changed', clone(sessions))
      return ok()
    },
    reorder: (ids) => {
      sessions = ids.map((id, i) => ({ ...sessions.find((s) => s.id === id), sortOrder: i + 1 }))
      emit('session:changed', clone(sessions))
      return ok()
    },
    pickDirectory: () => ok(null),
    openDirectory: () => ok(),
    onChanged: on('session:changed'),
  },
  settings: {
    get: () => ok(settings),
    update: (patch) => {
      const launchCommands = patch.launchCommands?.map((cmd, i) => ({
        ...cmd,
        id: cmd.id ?? `c-${Date.now()}-${i}`,
      }))
      settings = {
        launchCommands: launchCommands ?? settings.launchCommands,
        background: patch.background ?? settings.background,
      }
      emit('settings:changed', clone(settings))
      return ok(settings)
    },
    readBackgroundImage: (path) => ok((path ?? settings.background.imagePath) ? WALLPAPER : null),
    onChanged: on('settings:changed'),
  },
  update: {
    getStatus: () => ok({ state: 'idle' }),
    check: () => {
      emit('update:status', { state: 'none', version: '0.3.5' })
      return ok()
    },
    download: () => ok(),
    install: () => ok(),
    onStatus: on('update:status'),
  },
  tag: {
    list: () => ok(tagResult()),
    create: (name, color) => {
      const existing = tags.find((t) => t.name === name.trim())
      if (existing) return ok(existing)
      const t = {
        id: `t-${Date.now()}`,
        name: name.trim(),
        color: color ?? '#2A9D5C',
        sortOrder: tags.length + 1,
      }
      tags = [...tags, t]
      emit('tag:changed', clone(tagResult()))
      return ok(t)
    },
    update: (id, patch) => {
      tags = tags.map((t) => (t.id === id ? { ...t, ...patch } : t))
      emit('tag:changed', clone(tagResult()))
      return ok(tags.find((t) => t.id === id))
    },
    reorder: (ids) => {
      tags = ids.map((id, i) => ({ ...tags.find((t) => t.id === id), sortOrder: i + 1 }))
      emit('tag:changed', clone(tagResult()))
      return ok()
    },
    remove: (id) => {
      tags = tags.filter((t) => t.id !== id)
      sessionTags = sessionTags.filter((st) => st.tagId !== id)
      emit('tag:changed', clone(tagResult()))
      return ok()
    },
    attach: (sessionId, tagId) => {
      if (!sessionTags.some((st) => st.sessionId === sessionId && st.tagId === tagId))
        sessionTags = [...sessionTags, { sessionId, tagId }]
      emit('tag:changed', clone(tagResult()))
      return ok()
    },
    detach: (sessionId, tagId) => {
      sessionTags = sessionTags.filter((st) => !(st.sessionId === sessionId && st.tagId === tagId))
      emit('tag:changed', clone(tagResult()))
      return ok()
    },
    onChanged: on('tag:changed'),
  },
  agent: {
    list: () => ok([...runtime.values()]),
    setViewed: () => ok(),
    reportOutput: () => {},
    getHooksStatus: () => ok(hooks(true)),
    setHooks: (agent, enabled) => ok(hooks(enabled)[agent]),
    onStatus: on('agent:status'),
  },
  pty: {
    open: (sessionId) => {
      const created = !runtime.has(sessionId)
      if (created) {
        setRuntime(sessionId)
        setTimeout(() => emit('pty:data', sessionId, transcriptOf(sessionId)), 60)
      }
      return ok({ created, pid: (nextPid += 4) })
    },
    write: () => {},
    resize: () => ok(),
    kill: (sessionId) => {
      runtime.delete(sessionId)
      return ok()
    },
    isAlive: (sessionId) => ok(runtime.has(sessionId)),
    onData: on('pty:data'),
    onExit: on('pty:exit'),
  },
}

contextBridge.exposeInMainWorld('tagterm', api)
