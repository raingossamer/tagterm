# TagTerm 项目简报（给 Claude Code 的迭代提示词）

你是这个仓库的主力开发。先完整阅读本文件，再打开同目录下的 `tagterm-prototype.html`，然后按"工作方式"一节开始。

## 1. 我们在做什么

一个 Windows 桌面工具，解决这个痛点：我有很多项目要用 Claude Code / Gemini CLI / Codex 编程，现在每次都要找到项目文件夹 → 地址栏敲 cmd → 再敲 `claude`。

目标形态：

- 左栏是会话列表。**一个会话 = 一个固定工作目录的终端**（默认 cmd.exe）。
- 会话与标签是**多对多**。左栏按标签分组显示，同一个会话会出现在它所有标签的分组下；筛选支持"任一"（并集）和"全部"（交集）。
- 点击会话，右侧显示该目录的终端；终端里敲 `claude` / `gemini` / `codex` 或点按钮即可唤起对应 CLI。
- 关闭标签页不结束终端进程；关闭窗口最小化到托盘，进程继续跑。
- 能看出每个会话里的 agent 处于 **运行中 / 等待你确认 / 已完成未查看 / 空闲** 哪个状态。

`tagterm-prototype.html` 是 UI 与交互的**唯一标准**：布局、左栏分组逻辑、筛选语义、标签页行为、路径条、状态点颜色、文案，全部照它实现。它里面的"终端"是用字符串模拟的，你要把模拟层换成真实 PTY，其余交互保持一致。

## 2. 已定决策（不要重新讨论）

| 项 | 决定 |
|---|---|
| 路线 | **自持终端**：本应用自己 spawn 和持有 PTY 进程，不依赖 tmux / Herdr 等外部复用器 |
| 壳 | Electron + TypeScript |
| 终端 | node-pty（Windows ConPTY，要求 Win10 1809+）+ xterm.js（附 fit、webgl、search、unicode11 插件） |
| 前端 | Vue 3 + Vite + Pinia（如我在下方"待确认"里改成 React，则用 React + Zustand） |
| 包管理 | pnpm |
| 存储 | `%APPDATA%\TagTerm\sessions.json` 与 `tags.json`，不用数据库 |
| 打包 | electron-builder；node-pty 用 electron-rebuild 重编 |
| 语言 | 界面中文；代码注释、commit message 中文；标识符英文 |
| 目标平台 | Windows 优先，不为 macOS/Linux 做兼容妥协 |

**待确认（我会在这里改，改完你以这里为准）：**
- 前端框架：Vue 3
- 默认 shell：cmd.exe（备选 pwsh.exe）

## 3. 架构

三部分：

- **主进程**
  - `PtyManager`：`spawn(sessionId, {cwd, shell, cols, rows})` / `write` / `resize` / `kill`；维护 `sessionId → IPty` 映射；把输出通过 IPC 推给渲染进程；退出时清理。
  - `SessionStore`：读写两个 JSON，带版本号字段便于将来迁移；写入用先写临时文件再重命名。
  - `AgentDetector`：综合三路信号判定每个会话的运行时状态（见 §5）。
  - `HookServer`：监听 `127.0.0.1` 随机端口的本地 HTTP，接收 Claude Code hooks 回调。
  - `Tray`：托盘图标、"等待你"数量角标、右键菜单（显示窗口 / 退出）。
- **preload**：`contextBridge` 暴露 `pty.*`、`session.*`、`tag.*`、`agent.onStatus`，渲染进程不直接碰 Node。
- **渲染进程**
  - 组件：`TagFilter`（标签筛选 chips + 任一/全部）、`SessionGroups`（按标签分组的会话列表）、`TabBar`、`PathStrip`（路径、标签增删、唤起按钮）、`TerminalPane`。
  - **xterm 实例池**：每个已打开会话一个 `Terminal` 实例，挂在同一容器里，切换只切 `display` 并 `fit()` 后向 pty 发 resize。**禁止**用一个 Terminal 反复重灌数据——Claude Code 等 TUI 用 alt-screen，重灌会乱。

持久化的数据模型：

```ts
interface Session {
  id: string;            // uuid
  name: string;          // 显示名，默认取目录末段
  cwd: string;           // 固定工作目录
  shell: string;         // cmd.exe | powershell.exe | pwsh.exe
  startupCmd?: string;   // 打开会话后自动执行，如 "claude"
  lastAgent?: string;    // 最近唤起的工具
  sortOrder: number;
  createdAt: string;     // ISO
  lastOpenedAt?: string;
}
interface Tag { id: string; name: string; color: string; sortOrder: number }
interface SessionTag { sessionId: string; tagId: string }   // 多对多
```

运行时状态（`agent`、`status`、`pending`、滚动缓冲）只在内存，不落盘。

## 4. 里程碑

按顺序做，每个里程碑结束时停下来等我验收，不要提前做后面的事。

**M1 — 能用**
- Electron 壳跑起来，node-pty 起 cmd.exe，xterm.js 正常显示、能输入、能跑 `claude`（含 TUI 渲染、方向键、Ctrl+C）。
- 左栏**平铺**会话列表（先不做标签）；新建会话（选目录、名称、shell）；删除会话。
- 会话切换保留各自缓冲；标签页开关；关闭窗口最小化到托盘。
- 中文不乱码（见 §5）。
- 验收标准：我能在你的应用里打开 3 个项目目录，各自跑 `claude`，来回切换不丢内容，关窗口再从托盘打开仍在。

**M2 — 标签**
- 多对多标签；左栏按标签分组、同一会话多处出现、hover 时所有副本一起高亮；任一/全部筛选；未打标签分组；折叠状态记忆。
- 路径条上增删标签、新建标签；"管理标签"弹窗（改名、换色、删除）。
- 新建会话时若当前有筛选，标签预选。
- 搜索（Ctrl+K）。

**M3 — agent 状态**
- 实现 §5 的三路检测；状态点（绿=运行中，黄闪=等待你，蓝=已完成未查看，灰空心=空闲）同步到左栏、标签页、状态栏、托盘。
- 系统通知："xxx 等你确认"、"xxx 完成"。
- 会话被查看时 已完成 → 空闲。

**M4 — 打磨**
- 把 `PtyManager` 拆成独立 Node 子进程，命名管道通信，UI 崩溃不影响终端；启动时重连。
- 全局快捷键唤出窗口；配置导入导出；`startupCmd`；会话拖拽排序。

## 5. 实现要点（踩坑清单）

- **中文**：spawn 时 `env` 里加 `LANG=zh_CN.UTF-8`；cmd 用 `cmd.exe /k chcp 65001 >nul` 启动；xterm 字体栈 `"Cascadia Mono", Consolas, "Microsoft YaHei", monospace`，启用 unicode11 插件让中文占两格。
- **resize**：窗口和侧栏尺寸变化后必须 `fit()` 并把新 cols/rows 发给 pty，否则 TUI 错位。
- **agent 状态三路信号**（M3）：
  1. **Claude Code hooks（最可靠）**：首次运行时往 `~/.claude/settings.json`（用户级）写入 hooks，事件用 `Notification`（需要用户确认）、`Stop`（本轮结束）、`UserPromptSubmit`（用户提交了提示，进入运行中）、`SessionStart` / `SessionEnd`。hook 命令是 `curl -s "http://127.0.0.1:<port>/hook?event=<事件>&cwd=%CD%"`，主进程按 cwd 反查会话。写入前备份原文件，不覆盖用户已有的其他 hooks。
  2. **输出启发式（兜底，给 Gemini CLI / Codex 用）**：持续有输出 → 运行中；静默 >1.5s 且最后几行匹配 `(y/n)`、`Allow`、`❯`、`>` 等提示模式 → 等待你；静默无提示 → 空闲。
  3. **进程树（辅助）**：每 3–5s 用 `Get-CimInstance Win32_Process` 按 ParentProcessId 递归找 pty 子进程，识别 `claude` / `gemini` / `codex` 进程存在与否，决定"当前在哪个工具里"以及退出时清零。
- **cwd 追踪**：会话目录固定，但用户在里面 `cd` 了也要显示。cmd 提示符即 `C:\path>`，从输出流里正则抓最后一个提示行；PowerShell 抓 `PS C:\path>`。不要用读取进程 cwd 的 Windows API，不可靠。
- **唤起按钮**本质是 `pty.write('claude\r')`。
- **托盘退出**要 `kill` 所有 pty，防止孤儿 conhost。

## 6. 工作方式

1. 第一步：读完本文件和原型后，**先给我一份 M1 的实现计划**：目录结构、依赖清单（含版本）、IPC 接口签名、你打算怎么组织 xterm 实例池。等我确认再写代码。
2. 每次改动保持小步：一个功能一次 commit，commit message 中文，说明"做了什么"而不是"改了哪些文件"。
3. 遇到 node-pty 编译、ConPTY 行为、Electron 安全策略（contextIsolation、CSP）这类环境问题，先查官方文档再动手，不要绕过安全设置。
4. 不确定的产品决策（例如某个交互原型里没画到），先问我，不要自行发挥。
5. 每个里程碑结束时，给我一段"验收指引"：我要怎么操作才能验证你做的东西。
6. 不要修改 `tagterm-prototype.html`，它是参考原件。
