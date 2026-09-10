---
status: active   # active（进行中）/ done（收尾 design-doc-sync 时置为 done）
feature: tagterm-m1
date: 2026-09-10
---

# TagTerm M1「能用」— Implementation Plan

> 本文件即简报 §6 第 1 步要求的「M1 实现计划」：目录结构、依赖清单（含版本）、IPC 接口签名、xterm 实例池组织方式，外加按 ProjectModel 范式拆好的垂直切片。**等你确认后才开始写代码。**

## Parent Spec / RFC

- File: `tagterm-brief.md`（§1–§5；M1 范围以 §4「M1 — 能用」为准）+ `tagterm-prototype.html`（UI 与交互唯一标准）
- 说明：本项目的需求与决策由简报直接给出（§2 明确"不要重新讨论"），因此**未走 grill / write-a-spec**，简报 + 原型即本计划的 Spec。M2–M4 各自另出计划。
- 补充结论（用户 2026-09-10）：产品定位是"快捷保存多个项目的终端路径"；终端进程只在应用运行期间存活，退出后再启动需重新点开会话、重新输入 `claude` / `pi`。不做跨重启的会话保持、不做回放、不做重连。
- Design 五份文档已于 2026-09-10 按简报与原型填充（`to design` 正向模式），`tdd` 改码前按流程读取。

## Plan Overview

M1 的目标是一条能日常使用的最短闭环：**打开固定目录的真实 cmd → 在里面跑 `claude` → 多会话切换不丢内容 → 关窗进托盘进程不死**。

实施策略：

1. 先把三层（主进程 / preload / 渲染进程）打通并锁死安全策略（S1），所有后续切片都在这个安全基线上加功能。
2. 会话持久化（S2）先于终端（S3），因为终端要挂在会话上；S2 很薄，不会拖延对 node-pty / ConPTY 的风险验证。
3. 终端先做"单会话能用"（S3），再做"多会话切换 + 标签页"（S4）—— 实例池的多实例逻辑是 M1 最容易出错的地方，单独成片。
4. 托盘与生命周期（S5）放在终端之后，因为"退出要 kill 所有 pty"依赖 PtyManager 成型。
5. 打包（S6）独立成片，卡住时不阻塞验收（可先用 `pnpm dev` 验收）。
6. 最后一片是人工验收（S7, HITL），附验收指引。

切片之间是线性依赖：S1 → S2 → S3 → S4 → S5 → S6 → S7。

---

## 1. 目录结构

采用 electron-vite 的三段式约定（`src/main` / `src/preload` / `src/renderer`），另设 `src/shared` 存放两进程共用的类型与 IPC 契约。

```
tagterm/                             ← 仓库根（原 cmd plan，2026-09-10 决定改名）
├── package.json                     # pnpm.onlyBuiltDependencies: electron / node-pty / esbuild
├── pnpm-lock.yaml
├── .npmrc                           # electron_mirror、electron_builder_binaries_mirror、node-linker=hoisted
├── .gitignore
├── electron.vite.config.ts          # main / preload / renderer 三段构建
├── electron-builder.yml             # nsis 目标；asarUnpack node-pty；图标
├── tsconfig.json                    # 只做 references
├── tsconfig.node.json               # main + preload + shared（lib: ES2023，无 DOM）
├── tsconfig.web.json                # renderer + shared（lib: DOM）
├── vitest.config.ts                 # 两个 project：node（tests/main）、happy-dom（tests/renderer）
├── resources/
│   ├── icon.ico                     # 窗口 / 安装包图标
│   └── tray.png                     # 托盘图标（脚本生成的简单图形，后续可替换）
├── src/
│   ├── shared/                      # 两进程共用；禁止 import electron / node / vue
│   │   ├── models.ts                # Session / Tag / SessionTag / ShellKind / 文件格式
│   │   ├── ipc.ts                   # 通道名 + 每个通道的参数与返回类型（IPC 契约唯一真相源）
│   │   └── api.ts                   # window.tagterm 的 TagTermApi 类型（preload 实现、renderer 消费）
│   ├── main/
│   │   ├── index.ts                 # 入口：单实例锁、装配 store/pty/window/tray/ipc、退出清理
│   │   ├── window.ts                # createMainWindow：安全参数、close→hide、ready-to-show
│   │   ├── tray.ts                  # 托盘图标、tooltip、右键菜单（显示窗口 / 退出）
│   │   ├── ipc.ts                   # registerIpc(deps)：ipcMain.handle / on 薄层，只校验参数并转发
│   │   ├── pty/
│   │   │   ├── PtyManager.ts        # 深模块：spawn / write / resize / kill / killAll + 输出合并
│   │   │   └── shellArgs.ts         # 按 shell 生成 file / 命令行 / env 的纯函数（可单测）
│   │   └── store/
│   │       ├── SessionStore.ts      # 深模块：sessions.json / tags.json 读写、版本号、原子写
│   │       ├── jsonFile.ts          # readJson / writeJsonAtomic（先写 .tmp 再 rename）
│   │       └── paths.ts             # %APPDATA%\TagTerm 目录解析（可注入，测试用临时目录）
│   ├── preload/
│   │   └── index.ts                 # contextBridge.exposeInMainWorld('tagterm', api)
│   └── renderer/
│       ├── index.html               # 含 CSP meta
│       └── src/
│           ├── main.ts
│           ├── App.vue              # .app 双栏 grid（296px | 1fr），side-hidden 切换，照原型
│           ├── env.d.ts             # declare global { interface Window { tagterm: TagTermApi } }
│           ├── styles/
│           │   ├── tokens.css       # 原型 :root 变量原样搬入
│           │   └── base.css         # 原型全局样式（button/input reset、focus-visible 等）
│           ├── stores/
│           │   ├── sessions.ts      # 会话列表（主进程为真相源，onChanged 全量替换）+ CRUD action
│           │   └── workspace.ts     # openTabs / activeId / sideHidden / 每会话运行态（alive、exitCode）
│           ├── terminal/
│           │   ├── TerminalPool.ts  # xterm 实例池（纯 TS 类，不是组件；见 §4）
│           │   └── theme.ts         # 原型终端配色（Windows Campbell 色板）+ 字体栈 + 默认选项
│           └── components/
│               ├── SessionGroups.vue   # M1：单组平铺（无分组头）；M2 加标签分组
│               ├── TabBar.vue          # ☰ / 标签页 / ＋
│               ├── PathStrip.vue       # 路径、复制、唤起按钮、清屏、移除会话
│               ├── TerminalPane.vue    # 只负责提供容器给 pool 并挂 ResizeObserver
│               ├── StatusBar.vue
│               ├── EmptyState.vue      # 「选一个会话开始」
│               └── NewSessionModal.vue # 名称 / 目录（含「浏览…」）/ shell
└── tests/
    ├── main/
    │   ├── SessionStore.test.ts     # 真实临时目录，不 mock fs
    │   ├── shellArgs.test.ts
    │   └── PtyManager.test.ts       # 集成：真实 cmd.exe
    └── renderer/
        ├── workspace.store.test.ts  # 标签页语义
        ├── TerminalPool.test.ts     # 注入假 Terminal 工厂，只测编排
        └── components/*.test.ts     # Vue Test Utils + happy-dom，mock window.tagterm
```

分层规则（M1 起就执行）：

- `shared/` 是唯一被两侧 import 的目录，只放类型与常量。
- 主进程 `ipc.ts` 不含业务逻辑：解析参数 → 调 `SessionStore` / `PtyManager` → 返回。
- 渲染进程只通过 `window.tagterm` 说话，永不直接碰 `ipcRenderer`（contextIsolation + sandbox 也不允许）。
- `TerminalPool` 是纯 TS 类，组件只做挂载；这样实例池的编排逻辑可以不启动 xterm 就测试。

## 2. 依赖清单（含版本）

版本于 2026-09-10 在 registry.npmmirror.com 查得，按兼容矩阵锁定（精确版本，不加 `^`）：

| 包 | 版本 | 用途 / 锁定理由 |
|---|---|---|
| **dependencies** | | |
| node-pty | 1.1.0 | ConPTY；`install` 脚本先下载 prebuild、失败回退 node-gyp；基于 node-addon-api（N-API），同一二进制对 Node 与 Electron 都可用 |
| @xterm/xterm | 6.0.0 | 终端渲染 |
| @xterm/addon-fit | 0.11.0 | 与 xterm 6.0 配套 |
| @xterm/addon-webgl | 0.19.0 | 同上 |
| @xterm/addon-search | 0.16.0 | 同上（M1 只加载，M2 搜索时接线） |
| @xterm/addon-unicode11 | 0.9.0 | 同上；中文占两格 |
| vue | 3.5.42 | |
| pinia | 4.0.3 | 要求 TS ≥ 5.6 |
| **devDependencies** | | |
| electron | 44.3.0 | 当前 stable；内置 Node 24，要求本机 Node ≥ 22.12（本机 24.19） |
| electron-vite | 5.0.0 | peer 只声明 Vite ^5 / ^6 / ^7 —— **故不用 Vite 8** |
| vite | 7.3.6 | Vite 7 最新 |
| @vitejs/plugin-vue | 6.0.8 | 支持 Vite 7 |
| typescript | 5.9.3 | npm latest 已是 7.0.2（Go 原生版），vue-tsc / electron-vite 生态未对齐，**锁 5.9** |
| vue-tsc | 3.3.11 | `pnpm typecheck` |
| @types/node | 24.13.3 | 与 Electron 44 内置 Node 24 对齐 |
| electron-builder | 26.15.3 | nsis 打包 |
| @electron/rebuild | 4.2.0 | `electron-rebuild -f -w node-pty`（简报已定；N-API 下多为保险动作） |
| vitest | 4.1.11 | 支持 Vite 7；vitest 5.0.0 刚发布，暂不上 |
| @vue/test-utils | 2.5.0 | 组件测试 |
| happy-dom | 20.14.0 | 渲染进程测试环境 |
| prettier | 3.9.6 | 可选；是否引入 ESLint 等规范由 `to design` 的规范章节一次性确认 |

不引入 `uuid`（用 Node 24 的 `crypto.randomUUID()`）、不引入 UI 库（原型 CSS 直接复用）、不引入 electron-store（简报要求自管 JSON）。

安装相关配置：

```ini
# .npmrc
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
node-linker=hoisted          # 扁平 node_modules，避免 electron-builder / 原生模块的符号链接问题
```

```jsonc
// package.json 片段
"pnpm": { "onlyBuiltDependencies": ["electron", "node-pty", "esbuild"] },  // pnpm 10 默认拦截 install 脚本
"scripts": {
  "dev": "electron-vite dev",
  "build": "electron-vite build && electron-builder",
  "build:dir": "electron-vite build && electron-builder --dir",
  "typecheck": "vue-tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json",
  "test": "vitest run",
  "postinstall": "electron-rebuild -f -w node-pty"
}
```

## 3. IPC 接口签名

契约全部定义在 `src/shared/`，preload 与 main 双方按同一份类型实现，避免通道名与参数漂移。

### 3.1 数据模型（`shared/models.ts`）

```ts
export type ShellKind = 'cmd.exe' | 'powershell.exe' | 'pwsh.exe';

export interface Session {
  id: string;            // crypto.randomUUID()
  name: string;          // 缺省取目录末段
  cwd: string;
  shell: ShellKind;
  startupCmd?: string;   // M4
  lastAgent?: string;    // M3
  sortOrder: number;     // 新建 = 现有最大值 + 1
  createdAt: string;     // ISO
  lastOpenedAt?: string; // 每次打开终端时更新
}
export interface Tag { id: string; name: string; color: string; sortOrder: number }
export interface SessionTag { sessionId: string; tagId: string }

// 落盘格式（带版本号，便于将来迁移）
export interface SessionsFile { version: 1; sessions: Session[] }
export interface TagsFile { version: 1; tags: Tag[]; sessionTags: SessionTag[] }   // M2 才写；sessionTags 放这里，删标签时一次原子写
```

### 3.2 通道与类型（`shared/ipc.ts`）

```ts
export interface CreateSessionInput { cwd: string; name?: string; shell?: ShellKind }  // name 缺省=目录末段；shell 缺省=cmd.exe
export type SessionPatch = Partial<Pick<Session, 'name' | 'shell' | 'startupCmd' | 'sortOrder'>>;
export interface PtySize { cols: number; rows: number }
export interface PtyOpenResult {
  created: boolean;  // true=本次新 spawn；false=复用已在运行的 pty
  pid: number;
}
export interface PtyExitEvent { sessionId: string; exitCode: number; signal?: number }

// 请求 / 响应：ipcRenderer.invoke ↔ ipcMain.handle
export interface IpcInvokeMap {
  'app:get-version':        { args: [];                                  result: string };
  'session:list':           { args: [];                                  result: Session[] };
  'session:create':         { args: [input: CreateSessionInput];         result: Session };
  'session:update':         { args: [id: string, patch: SessionPatch];   result: Session };
  'session:remove':         { args: [id: string];                        result: void };       // 同时 kill 其 pty
  'session:pick-directory': { args: [];                                  result: string | null }; // dialog.showOpenDialog
  'pty:open':               { args: [sessionId: string, size: PtySize];  result: PtyOpenResult }; // 幂等
  'pty:resize':             { args: [sessionId: string, size: PtySize];  result: void };
  'pty:kill':               { args: [sessionId: string];                 result: void };
  'pty:is-alive':           { args: [sessionId: string];                 result: boolean };
}

// 单向高频：ipcRenderer.send → ipcMain.on（键入不等待响应）
export interface IpcSendMap {
  'pty:write': [sessionId: string, data: string];
}

// 主进程 → 渲染进程：webContents.send → ipcRenderer.on
export interface IpcEventMap {
  'pty:data':        [sessionId: string, data: string];   // 主进程侧按 ≤16 ms 或 ≥64 KB 合并后再发
  'pty:exit':        [event: PtyExitEvent];
  'session:changed': [sessions: Session[]];               // 任何会话数据变更后广播全量列表（主进程是真相源）
}
```

M2 预留 `tag:*` 通道与 `session-tag:*`，M3 预留 `agent:status` 事件，M1 不实现、不占位。

### 3.3 preload 暴露的 API（`shared/api.ts`，挂在 `window.tagterm`）

SDK 风格：每个操作一个具体函数，渲染进程测试时按函数 mock。

```ts
export type Unsubscribe = () => void;

export interface TagTermApi {
  app: {
    getVersion(): Promise<string>;
  };
  session: {
    list(): Promise<Session[]>;
    create(input: CreateSessionInput): Promise<Session>;
    update(id: string, patch: SessionPatch): Promise<Session>;
    remove(id: string): Promise<void>;
    pickDirectory(): Promise<string | null>;
    onChanged(cb: (sessions: Session[]) => void): Unsubscribe;
  };
  pty: {
    open(sessionId: string, size: PtySize): Promise<PtyOpenResult>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, size: PtySize): Promise<void>;
    kill(sessionId: string): Promise<void>;
    isAlive(sessionId: string): Promise<boolean>;
    onData(cb: (sessionId: string, data: string) => void): Unsubscribe;
    onExit(cb: (e: PtyExitEvent) => void): Unsubscribe;
  };
  // M2: tag.*   M3: agent.onStatus()
}
```

preload 在 `sandbox: true` 下运行，只能用 `contextBridge` / `ipcRenderer`，正好够用。所有 `on*` 返回取消订阅函数，实例池销毁时调用，避免监听器泄漏。

### 3.4 主进程内部模块接口（深模块，测试只打边界）

```ts
// main/pty/PtyManager.ts
export class PtyManager {
  constructor(deps: {
    onData: (sessionId: string, data: string) => void;   // 已合并的批次
    onExit: (e: PtyExitEvent) => void;
  });
  spawn(sessionId: string, opts: { cwd: string; shell: ShellKind; cols: number; rows: number }): { pid: number };
  has(sessionId: string): boolean;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;
  killAll(): void;                                       // 托盘退出 / before-quit 调用，防孤儿 conhost
}

// main/pty/shellArgs.ts —— 纯函数
export function buildSpawnSpec(shell: ShellKind, cwd: string, env: NodeJS.ProcessEnv):
  { file: string; commandLine: string; env: Record<string, string> };
// cmd.exe        → file 'cmd.exe',        commandLine '/k chcp 65001 >nul'
// powershell.exe → file 'powershell.exe', commandLine '-NoLogo -NoExit -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 | Out-Null"'
// pwsh.exe       → 同 powershell.exe
// env 追加 LANG=zh_CN.UTF-8
// 注意：node-pty 在 Windows 上接受字符串形式的 args 作为原始命令行，避免它给含空格的参数加引号后
//       让 cmd 把 "chcp 65001 >nul" 当成一个命令名（> 是 cmd 特殊字符，引号不会被剥掉）。

// main/store/SessionStore.ts
export class SessionStore {
  constructor(dir: string);                              // 注入目录；生产传 %APPDATA%\TagTerm，测试传临时目录
  load(): Promise<void>;                                 // 文件不存在 → 空；version 不符 → 迁移（M1 仅 v1）
  list(): Session[];
  create(input: CreateSessionInput): Promise<Session>;
  update(id: string, patch: SessionPatch): Promise<Session>;
  remove(id: string): Promise<void>;
  touchOpened(id: string): Promise<void>;                // 写 lastOpenedAt
}
```

## 4. xterm 实例池（`renderer/src/terminal/TerminalPool.ts`）

```ts
interface Entry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  webgl: WebglAddon | null;        // 只有当前可见实例持有
  host: HTMLDivElement;            // position:absolute; inset:0; display:none|block
  unsubs: Unsubscribe[];
}

export class TerminalPool {
  constructor(deps: { pty: TagTermApi['pty']; createTerminal?: (o: ITerminalOptions) => Terminal });
  attach(container: HTMLElement): void;   // TerminalPane onMounted；注册 ResizeObserver 与全局 onData/onExit 各一份
  detach(): void;
  open(session: Session): Promise<void>;  // 幂等：无实例 → 建实例 + term.open(host) + fit → pty.open(id, {cols, rows})
  show(sessionId: string): void;          // 其余 host display:none，目标 display:block；rAF 后 fit() + focus()；WebGL 挪到该实例
  hide(): void;                           // 没有活动会话（空状态）
  fitActive(): void;                      // ResizeObserver 回调；只 fit 可见实例
  dispose(sessionId: string): void;       // 移除会话 / 重启 shell 时：取消订阅、term.dispose()、移除 host
  has(sessionId: string): boolean;
}
```

组织规则：

1. **一个会话一个 `Terminal`，与 pty 同寿命**。关闭标签页只是从 `workspace.openTabs` 移除，实例与 pty 都保留；只有「移除会话」或 pty 退出后重启才 `dispose`。绝不复用一个 Terminal 重灌数据。
2. **所有实例挂在同一个容器里**（`TerminalPane` 的根元素，`position:relative; flex:1; min-height:0`），每个实例一个绝对定位的 `host`。切换只切 `display`。
3. **fit 只在可见时做**：`display:none` 下 xterm 量不到尺寸（会得到 NaN）。`show()` 在 `requestAnimationFrame` 里 `fit()`；`ResizeObserver` 只对可见实例 fit；被隐藏的实例在下次 `show()` 时补 fit。侧栏 ☰ 收起 / 展开也会触发 ResizeObserver。
4. **resize 只从 `term.onResize` 发出**：`fit()` 改变了 cols/rows 才会触发 `onResize → pty.resize`，保证 pty 尺寸永远等于可见终端的尺寸；切回一个尺寸已变的会话时 ConPTY 会全量重绘 TUI（会闪一下，属正常）。
5. **输入输出路由**：`term.onData → pty.write(id, data)`；全池只订阅一次 `pty.onData`，按 `sessionId` 写入对应实例（隐藏实例照常写入缓冲区，显示时再绘）。
6. **WebGL 只挂在当前可见实例上**：Chromium 每页 WebGL 上下文约 16 个上限，开十来个会话就会开始丢上下文。`show()` 时把上一个实例的 `WebglAddon` dispose、给新实例加载；`onContextLoss` 时 dispose 并退回 DOM 渲染器。
7. **默认选项**（`theme.ts`）：`fontFamily: '"Cascadia Mono", Consolas, "Microsoft YaHei", monospace'`（三者本机均已安装）、`fontSize: 14`、`scrollback: 5000`、`cursorBlink: true`、`windowsPty: { backend: 'conpty', buildNumber: <os.release 的 build 号> }`（替代已弃用的 `windowsMode`）、Unicode11 addon 加载后 `term.unicode.activeVersion = '11'`、配色用原型给出的 Windows Campbell 色板（bg `#0C0C0C`、fg `#CCCCCC`、green `#16C60C`、yellow `#F9F1A5`、red `#E74856`、cyan `#61D6D6`、blue `#3B78FF`）。
8. **不回放**：会话不跨应用重启保留（用户 2026-09-10 决定），因此不做输出回放，也不做重连。渲染进程整页重载（开发期 HMR）后 `pty.open` 复用已在运行的 pty，终端从空白开始，按回车即出提示符。
9. **退出处理**：收到 `pty:exit` → 在该实例末尾写 `\r\n[进程已退出，代码 N]\r\n`，`workspace` 标记 `alive=false`；重启策略见「待你确认」#2。

## 5. M1 其他关键决策

| 主题 | 决定 |
|---|---|
| 安全策略 | `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`（xterm 的 DOM 渲染器会动态注入 `<style>` 元素，style 必须放开 inline；script 严格 `'self'`）。开发期额外允许 Vite HMR 的 `ws://localhost:*`。不绕过任何安全设置。 |
| 窗口 | 1200×760，最小 800×520，`autoHideMenuBar`，`backgroundColor '#E9ECF0'`，`show: false` 到 `ready-to-show` |
| 关闭 → 托盘 | `win.on('close')` 在非退出状态下 `preventDefault()` + `hide()`；`window-all-closed` 不退出 |
| 退出 | 托盘「退出」与 `before-quit` 都走 `ptyManager.killAll()`，再 `app.quit()`；单实例锁，二次启动只聚焦已有窗口 |
| 存储位置 | `path.join(app.getPath('appData'), 'TagTerm')`（= `%APPDATA%\TagTerm`）；`sessions.json` / `tags.json`；写入走 `.tmp` + `rename` |
| pty 何时 spawn | 首次点击会话时才 spawn（启动时不为每个会话起 shell） |
| 会话生命周期 | 等于应用生命周期：托盘「退出」即 kill 全部 pty，下次启动只恢复会话列表，不恢复终端、不重连，用户需重新点开会话并重新输入 `claude` / `pi`；原简报 M4「PtyManager 拆独立子进程 + 启动时重连」取消（用户 2026-09-10 决定） |
| 输出批处理 | 主进程按会话累积输出，16 ms 定时或超过 64 KB 立即 flush，减少 IPC 次数 |
| 唤起按钮 | `pty.write(sessionId, 'claude\r')`；M1 无 agent 检测，路径条固定显示「唤起」+ claude / gemini / codex 三个按钮 + 清屏 + 移除会话（原型里的「当前：xx，运行中」与「退出 xx」按钮属 M3） |
| 清屏 | cmd → `cls\r`；PowerShell → `clear\r` |
| 移除会话 | 用原型文案确认（`移除会话 "x"？终端进程会被结束。`），确认后 kill pty → 删文件记录 → dispose 实例 → 关标签页 |
| 原型裁剪（M1 不做） | 左栏搜索框、标签筛选区、会话行右侧标签色点、路径条「+ 标签」与标签胶囊、「管理标签」按钮、hover 副本联动 —— 全部 M2；状态点全部为「空闲」灰空心、状态栏三项计数为 0 —— M3 填充 |
| 提交 | 每个切片至少一个 commit，中文，说明做了什么 |

---

## 6. Slices

### Slice 1: 脚手架与安全基线

- **Type**: AFK
- **Blocked by**: None
- **User stories**: 简报 M1「Electron 壳跑起来」
- **Complexity**: M

**What to build**:
建立 pnpm + electron-vite + Vue 3 + Pinia + TS 工程，锁定 §2 依赖版本，写入 `.npmrc` 与 `pnpm.onlyBuiltDependencies`，安装 node-pty 并跑通 `electron-rebuild`。窗口打开后显示原型的空状态「选一个会话开始」，状态栏经 preload → IPC 取到应用版本并显示 —— 这是贯穿三层的 tracer bullet。安全参数与 CSP 一次到位。vitest 两个 project 配好并有 smoke 测试。`git init` 并做首个 commit。

**Acceptance criteria**:
- [x] `pnpm install` 成功；主进程启动日志打印 node-pty 已加载（证明原生模块在 Electron 下可用）
- [x] `pnpm dev` 打开窗口，空状态文案、字体、配色与原型一致；状态栏显示版本号（来自主进程）
- [x] DevTools 无 CSP 报错；渲染进程里 `window.process` / `require` 不存在
- [x] `pnpm test`、`pnpm typecheck` 通过
- [x] 首个 commit 已提交

**Implementation hints**:
- 用脚本生成一个简单的 `resources/tray.png` 与 `icon.ico` 占位，后续可替换
- 若 prebuild 下载失败，node-pty 回退 node-gyp：本机有 VS 2022 Community + Python 3.13，可以编译

---

### Slice 2: 会话持久化与左栏列表

- **Type**: AFK
- **Blocked by**: Slice 1
- **User stories**: 简报 M1「左栏平铺会话列表；新建会话（选目录、名称、shell）；删除会话」
- **Complexity**: M

**What to build**:
`SessionStore` 读写 `%APPDATA%\TagTerm\sessions.json`（v1、原子写、目录自动创建、坏文件报错不静默清空）。`session:*` IPC 与 preload。渲染进程 `sessions` store 以主进程广播为准。左栏按原型平铺渲染会话行（状态点、名称、路径末两段、hover、active 左侧蓝条）。新建会话弹窗：名称、目录（可手输或「浏览…」调系统对话框）、shell 下拉；目录必填，名称缺省取末段；Enter 创建。路径条显示路径、复制、移除会话（带确认）。点击会话成为 active（终端区暂为黑底占位，S3 接上）。状态栏显示「N 个会话」。

**Acceptance criteria**:
- [x] 新建后 `sessions.json` 为 `{ "version": 1, "sessions": [...] }`；重启应用列表仍在
- [x] 写入不留 `.tmp` 残留；`TagTerm` 目录不存在时自动创建
- [x] 目录为空时不允许创建并聚焦目录框（原型行为）；名称留空取目录末段
- [x] 移除会话弹确认，确认后列表与文件同时更新
- [x] 复制按钮复制路径并短暂显示「已复制」

**Implementation hints**:
- `SessionStore` 测试用真实临时目录，覆盖：新建→列出→重新 load、更新、删除、坏 JSON、无 .tmp 残留
- `NewSessionModal` 用 VTU 测：空目录拦截、缺省名称、Enter 提交；`window.tagterm` 按函数 mock

---

### Slice 3: 终端 —— PTY 与 xterm 单会话

- **Type**: AFK
- **Blocked by**: Slice 2
- **User stories**: 简报 M1「node-pty 起 cmd.exe，xterm.js 正常显示、能输入、能跑 claude（TUI、方向键、Ctrl+C）」「中文不乱码」
- **Complexity**: L

**What to build**:
`shellArgs` + `PtyManager`（spawn / write / resize / kill / killAll、输出合并）、`pty:*` IPC 与 preload、`TerminalPool` 的单实例路径、`TerminalPane`、主题与字体、Unicode11、WebGL、窗口尺寸变化后 fit 并同步 pty 尺寸。点击会话即在其固定目录起 cmd。

**Acceptance criteria**:
- [x] 点击会话看到 `C:\该目录>` 提示符；`dir` 正常；`echo 你好` 与含中文的文件名显示正确；输入中文不乱码
- [ ] 输入 `claude`：TUI 正常绘制，方向键 / 回车可用，Ctrl+C 可中断，中文占两格不错位
- [ ] 拖动窗口大小，终端重排、TUI 不错位
- [x] WebGL 渲染生效（DevTools 可见 canvas）；模拟上下文丢失时自动回退 DOM 渲染器且内容不丢
- [x] `pty:data` 在主进程合并后发送（DevTools 里不再是逐字节事件）

**Implementation hints**:
- `PtyManager` 集成测试起真实 `cmd.exe`：写 `echo ok\r` 收到 `ok`；`resize` 不抛；`kill` 触发 exit；`killAll` 后无残留
- `shellArgs` 纯函数测试：三种 shell 的命令行与 `LANG`
- `TerminalPool` 注入假 Terminal 工厂测：`open` 幂等、`onData` 路由到正确实例、`dispose` 取消订阅

---

### Slice 4: 多会话切换与标签页

- **Type**: AFK
- **Blocked by**: Slice 3
- **User stories**: 简报 M1「会话切换保留各自缓冲；标签页开关」；§5「唤起按钮」
- **Complexity**: M

**What to build**:
`TabBar`（☰ 收起侧栏、标签页、×、＋）与 `workspace` store 的标签页语义（选中即加标签页；关闭当前页激活 `min(i, len-1)` 位置的邻居；关闭非当前页不改 active；标签页全关回到空状态）。实例池多实例：切换只切 `display`、show 后 fit、WebGL 单活动实例、ResizeObserver。关闭标签页不动 pty；移除会话 kill pty + dispose + 关标签页。路径条唤起按钮（`claude` / `gemini` / `codex` → `write('<cmd>\r')`）与清屏。pty 退出提示与重启。打开终端时更新 `lastOpenedAt`。

**Acceptance criteria**:
- [ ] 打开 3 个不同目录会话各自跑 `claude`，来回切换内容不丢、TUI 不乱
- [x] 关闭标签页后 pty 仍在（任务管理器可见）；从左栏点回来内容与进程原样
- [x] 关闭当前标签页时激活的邻居与原型规则一致；全关后显示空状态
- [x] 唤起按钮效果等同于在终端敲 `claude⏎`；清屏按钮生效
- [x] ☰ 收起 / 展开侧栏后终端自动重排
- [ ] 同时打开 ≥ 8 个会话不出现 WebGL 上下文丢失告警

**Implementation hints**:
- `workspace` store 单测覆盖全部标签页语义（这是纯逻辑，最值得测）
- `TerminalPool` 测：`show(a)` 后只有 a 可见、WebGL 只挂在 a 上、`show(b)` 后从 a 挪到 b

---

### Slice 5: 托盘与生命周期

- **Type**: AFK
- **Blocked by**: Slice 4
- **User stories**: 简报 M1「关闭窗口最小化到托盘」；§5「托盘退出要 kill 所有 pty」
- **Complexity**: M

**What to build**:
窗口 × → 隐藏到托盘；托盘图标、tooltip「TagTerm」、单击显示 / 聚焦窗口、右键菜单「显示窗口」「退出」；退出与 `before-quit` 统一 `killAll`；单实例锁；`window-all-closed` 不退出。

**Acceptance criteria**:
- [ ] 点 × 后窗口消失、托盘图标存在；终端进程仍在跑（正在运行的 `claude` 不中断）
- [ ] 从托盘恢复窗口，所有会话内容、标签页、active 原样
- [ ] 托盘「退出」后任务管理器无残留 `cmd.exe` / `conhost.exe` / `OpenConsole.exe` / claude 的 node 进程
- [ ] 再次启动应用只聚焦已有窗口，不开第二个实例

**Implementation hints**:
- Electron 主进程 UI 行为（托盘、窗口）不做自动化测试，靠验收指引手工验证；`killAll` 已在 S3 有集成测试

---

### Slice 6: 打包

- **Type**: AFK
- **Blocked by**: Slice 5
- **User stories**: 简报 §2「打包 electron-builder；node-pty 用 electron-rebuild 重编」
- **Complexity**: S

**What to build**:
`electron-builder.yml`：nsis 目标、`asarUnpack` node-pty（原生 `.node` 与 ConPTY 附属文件必须在 asar 外）、图标、`pnpm build` 产出 `dist/TagTerm Setup 0.1.0.exe`。

**Acceptance criteria**:
- [ ] 安装包可安装、启动、开终端、跑 `claude`
- [ ] 安装版读写的仍是 `%APPDATA%\TagTerm`；卸载不删数据
- [ ] 若镜像下载或签名等环境问题卡住，退而交付 `pnpm build:dir` 的免安装目录，安装包推到 M4

---

### Slice 7: M1 验收

- **Type**: HITL
- **Blocked by**: Slice 6
- **User stories**: 简报 M1 验收标准「打开 3 个项目目录，各自跑 claude，来回切换不丢内容，关窗口再从托盘打开仍在」
- **Complexity**: S

**What to build**:
输出验收指引（逐步操作 + 预期现象），你按指引验收；修复发现的问题；M1 收尾 commit；随后自动进入 design-doc-sync。

**Acceptance criteria**:
- [ ] 你确认简报 M1 验收标准全部通过
- [ ] 验收中发现的问题已修复并提交

## 7. Dependency Graph

```
Slice 1 → Slice 2 → Slice 3 → Slice 4 → Slice 5 → Slice 6 → Slice 7 (HITL)
```

## 8. Risk Notes

| 风险 | 缓解 |
|---|---|
| pnpm 10 默认拦截 install 脚本，electron 二进制与 node-pty prebuild 不会下载 | `pnpm.onlyBuiltDependencies` 白名单；`.npmrc` 指向 npmmirror 的 electron 镜像 |
| node-pty prebuild 下载失败回退 node-gyp 编译，仓库路径含空格（`cmd plan`） | 本机有 VS 2022 + Python 3.13 可编译；建议改目录名（待你确认 #1） |
| xterm 6.0 是大版本，addon 必须配套版本；`windowsMode` 已弃用 | 版本表已按 6.0 配套锁定；用 `windowsPty` 选项 |
| WebGL 上下文上限（约 16 个）| 只有可见实例挂 WebGL；上下文丢失回退 DOM 渲染器 |
| 切换会话触发 ConPTY 重绘，alt-screen TUI 会闪 | 属 ConPTY 正常行为；只在尺寸变化时才 resize 可减少重绘 |
| `chcp 65001` 后仍有工具按 GBK 输出（老式 .NET / 部分批处理） | 不在 M1 范围；M4 可加每会话编码选项 |
| 大量输出（如 `type` 大文件）时 IPC 与 xterm 写入堆积卡 UI | M1 先做 16 ms 批处理；M4 用 node-pty `pause()/resume()` 做背压 |
| TypeScript 7 / Vite 8 与 electron-vite、vue-tsc 未对齐 | 锁 TS 5.9.3、Vite 7.3.6，升级另议 |
| 渲染进程整页重载（开发期常见）后终端空白 | 产品上会话不跨重启保留，不做回放；按回车即出提示符 |
| Electron 主进程 UI（托盘 / 窗口）无自动化测试 | 用验收指引手工覆盖；逻辑尽量下沉到可测的纯模块 |

## 9. 待你确认的问题（原型没画到或简报未定）

已答复（2026-09-10）：

- 仓库目录改名 `tagterm` —— 已定。
- 产品定位：只是快捷保存多个项目终端路径；终端进程只在应用运行期间存活，退出后再启动需重新点开会话、重新输入 `claude` / `pi`。由此取消回放缓冲与 M4 的子进程拆分 / 重连。
- Design 五份文档已按简报与原型填充。

未答复、暂按以下推荐执行（随时可改）：

1. **pty 退出后的行为**：终端保留最后输出并追加 `[进程已退出，代码 N]`，再次点击该会话行或在该终端按回车即重新启动 shell；不额外加按钮。
2. **shell 选择控件**：新建弹窗「目录」下加「Shell」下拉，默认 cmd.exe；启动时探测 PATH，未安装的（本机没有 pwsh）不显示。
3. **M1 隐藏标签相关 UI**（搜索框、筛选区、标签色点、+ 标签、管理标签），M2 一并加回。
4. **状态栏三项计数** M1 显示 0，保持原型布局。
5. **cwd 追踪**放 M3，与输出启发式共用同一条输出扫描逻辑。
6. **唤起按钮是否加 `pi`**：你提到用 `pi` 启动 pi；本机已装 claude / gemini / pi，未装 codex。推荐：按钮列表可配置，默认 `claude / gemini / codex / pi`，启动时探测 PATH，未安装的不显示（本机会显示 claude / gemini / pi）。M1 暂按此执行。
7. **规范章节确认**：Design 文档中标「社区基线草案，待确认」的条目需要你一次性确认，确认前 `tdd` 会把它们视为未决。
8. **产物前缀** `tagterm-m1`，M2–M4 依次为 `tagterm-m2` 等。

## 10. Status Tracking

| Slice | Status | Assignee | Notes |
|-------|--------|----------|-------|
| 1 脚手架与安全基线 | 🟢 Done | Claude | 2026-09-10；commit d3c0882；偏差见 §11 |
| 2 会话持久化与左栏列表 | 🟢 Done | Claude | 2026-09-10；commit 9b2ceb8；偏差见 §11 |
| 3 终端：PTY 与 xterm 单会话 | 🟢 Done | Claude | 2026-09-10；commit 869e97b；偏差见 §11；「拖动窗口重排」「WebGL 上下文丢失回退」两项留 S7 人工验证 |
| 4 多会话切换与标签页 | 🟢 Done | Claude | 2026-09-10；commit 5196e07；偏差见 §11；「3 个 claude TUI 来回切换不乱」「≥8 会话无 WebGL 告警」留 S7 人工验证 |
| 5 托盘与生命周期 | 🔴 Not started | - | - |
| 6 打包 | 🔴 Not started | - | - |
| 7 M1 验收（HITL） | 🔴 Not started | - | - |

Status: 🔴 Not started | 🟡 In progress | 🟢 Done | ⚠️ Blocked

## 11. 偏差记录（tdd 逐片追加）

### Slice 1

| 偏差 | 原因 | 影响 |
|------|------|------|
| 去掉 `postinstall: electron-rebuild -f -w node-pty`，并移除 `@electron/rebuild` 依赖 | node-pty 1.1.0 的 npm 包自带 `prebuilds/win32-x64`（N-API，Node 与 Electron 通用），运行时 `loadNativeModule` 直接加载；而该包内 winpty 的 gyp 依赖在本机执行 `GetCommitHash.bat` 失败，electron-rebuild 无法完成。Electron 44 下已验证原生模块可加载并起 cmd.exe | Slice 6 打包时 `asarUnpack` 需包含 `node_modules/node-pty/prebuilds/**`（而非 `build/Release`） |
| `pnpm.onlyBuiltDependencies` 从 package.json 移到 `pnpm-workspace.yaml` | pnpm 11 不再读取 package.json 的 `pnpm` 字段 | 无 |
| S1–S4 期间 `window-all-closed` 直接 `app.quit()` | 托盘尚未实现（S5），否则关窗后进程无法退出 | S5 改为常驻托盘、`window-all-closed` 不退出 |
| 新增 `src/main/smoke.ts`：`TAGTERM_SMOKE=1` 时页面加载后核查安全基线并打印 JSON 退出 | 无人值守验收「DevTools 无 CSP 报错 / 无 window.process / require」等项 | 生产运行不触发；Design 目录结构需补记（design-doc-sync） |

### Slice 2

| 偏差 / 补充 | 原因 | 影响 |
|------|------|------|
| 新增 invoke 通道 `app:list-shells`（返回 PATH 上存在的 `ShellKind[]`），探测逻辑为纯函数 `main/shells.ts` | 落实 Plan §9 #2/#3「Shell 下拉只显示已安装的 shell」需要主进程探测 | Design backend.md「API 端点」与 frontend.md「API 调用层」需补记该通道（design-doc-sync） |
| `SessionStore` 构造签名为 `(dir, { onChanged? })`，每次落盘后回调全量列表，由装配层广播 `session:changed` | 遵循 backend.md 模块边界「数据变更后通过回调通知装配层广播」；Plan §3.4 只写了 `(dir)` | 无 |
| `SessionStore.touchOpened` 未在本片实现 | 只有 `pty:open` 用到，留到 Slice 3 一起做，避免无测试的预写 | 无 |
| 渲染进程新增 `composables/path.ts`（`pathTail`）与 `composables/useCopy.ts` | 原型 `tail()` 与「已复制」反馈的纯逻辑抽出，组件只渲染 | frontend.md 目录结构需补记 `path.ts` |
| `workspace` store 在本片已带 `openTabs` / `closeTab`（S4 才接 TabBar） | `select` 语义（选中即加标签页）与 `onSessionRemoved`（关其标签页并切邻居）本片就需要，closeTab 是同一条规则 | S4 只需补 `toggleSide` 与 TabBar 组件 |
| 数据目录与 Electron 的 userData 同为 `%APPDATA%\TagTerm`（Windows 路径不区分大小写），目录内同时存在 Chromium 缓存文件 | `package.json` name 为 tagterm，Electron 默认 userData = `%APPDATA%\<name>` | 无功能影响；S6「卸载不删数据」时注意该目录 |

### Slice 3

| 偏差 / 补充 | 原因 | 影响 |
|------|------|------|
| 渲染进程新增 `terminal/TerminalInstance.ts`（实例抽象）、`terminal/xtermFactory.ts`（真实 xterm + addon 工厂）、`terminal/poolKey.ts`（provide/inject key）；`TerminalPool` 只做编排 | 让实例池能注入假终端测试（Plan §1 tests 的要求），xterm 细节集中在工厂里 | frontend.md 目录结构需补记 |
| 新增 invoke 通道 `app:get-os-build`（Windows 构建号） | xterm `windowsPty.buildNumber` 需要 `os.release()`，渲染进程拿不到 | Design API 端点需补记 |
| `PtyManager` 增加 `getPid(id)` | `pty:open` 复用已有 pty 时要返回 pid（Plan §3.2 `PtyOpenResult.pid`） | 无 |
| `pty:open` 时实例的 host 仍是 `display:none`，首次 spawn 用 80×24 兜底，随后 `show()` fit 触发 `onResize → pty:resize` 同步真实尺寸 | fit 在不可见宿主上量不到尺寸（Plan §4 规则 3） | 首个提示符出现后会有一次重排，属正常 |
| xterm 主题用完整 Campbell 16 色（原型 `--t-*` 只给了亮色 7 项，即其中的 bright 系列） | TUI 需要 16 色 | 无 |
| `App.vue` 的工作区用 `v-show` 而非 `v-if`，TerminalPane 常驻 | 实例池容器不能随空状态切换而卸载 | 无 |
| 验收项「输入 claude 的 TUI / 方向键 / Ctrl+C」「拖动窗口重排」「模拟 WebGL 上下文丢失」未自动化 | 需要交互；烟测已覆盖提示符 / 中文 echo / canvas 存在 | 留 Slice 7 人工验收 |
| 风险：node-pty `kill()` 时打印 `Error: AttachConsole failed`（枚举控制台子进程失败），主 shell 已确认被结束，但 shell 内正在运行的子进程（如 claude）是否随之结束待验证 | node-pty 在无控制台的进程里 AttachConsole 失败 | Slice 5「托盘退出无残留进程」验收时重点检查；必要时改用 `taskkill /T /PID` 兜底 |

### Slice 4

| 偏差 / 补充 | 原因 | 影响 |
|------|------|------|
| 唤起按钮列表 = `DEFAULT_AGENTS`（claude / gemini / codex / pi）经 PATH 探测过滤，新增 invoke 通道 `app:list-agents`；探测泛化为 `main/pathProbe.ts`（原 `shells.ts` 并入） | 落实 Plan §9 #6 的推荐执行方案；本机显示 claude / gemini / pi | 「可配置列表」的设置 UI 未做（M4 配置项）；Design API 端点 / 目录结构需补记 |
| `TerminalPool` 增加 `onExit` / `onRestartRequested` 回调与"已退出实例不再转发按键"的规则；重启 = `dispose` + `open`，由 `App.vue` 编排 | 落实 Plan §9 #1「退出后按回车或再次点击会话行即重启」 | 无 |
| `App.vue` 监听 `workspace.activeId` 变化直接 `pool.show / hide` | 标签页点击、关闭邻居切换都只切 display，不必经过 selectSession 的 open 路径 | 无 |
