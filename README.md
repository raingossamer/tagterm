# TagTerm

一个 Windows 桌面小工具：**把常用项目目录保存成终端会话**，点一下就打开固定在该目录的 cmd / PowerShell，多个会话像浏览器标签页一样切换，关窗进托盘、终端进程不中断。适合同时在多个项目里跑 `claude`、`gemini`、`codex`、`pi` 这类命令行 AI 工具的人。

## 功能（v0.2.x）

- **会话即路径**：新建会话只需选一个目录（名称缺省取目录末段，可选 cmd.exe / PowerShell / pwsh），列表持久化在 `%APPDATA%\TagTerm\sessions.json`。右键会话可编辑名称 / 目录 / Shell（终端里有程序在跑时拒绝改目录 / Shell，空闲则自动在新目录重启），也可移除会话（二次确认）。
- **真实终端**：node-pty（ConPTY）+ xterm.js，UTF-8 中文不乱码；一个会话一个终端实例，切换不丢内容；仅当前可见终端启用 WebGL 渲染。
- **标签页**：打开的会话显示为标签页，关闭标签页不结束进程；终端进程退出后按回车或再点会话即重启。
- **唤起命令**：路径条上的一排按钮，点击等于在终端敲 `claude⏎`。首次运行按 PATH 自动生成，之后可在「编辑」里自定义任意命令、设常用 / 收进「更多 ▾」、拖拽排序（存于 `settings.json`）。
- **剪贴板**：Ctrl+V / Shift+Insert 粘贴，Ctrl+Shift+C 复制，Ctrl+C 有选区复制、无选区中断；右键有选区复制、无选区粘贴。
- **托盘常驻**：点 × 只隐藏到托盘，所有终端继续运行；托盘菜单：显示窗口 / 设置 / 退出（退出会结束全部终端）。单实例，二次启动只聚焦已有窗口。
- **设置**（左栏齿轮或托盘「设置」打开，左侧四段导航）：**外观** —— 全局背景图铺满整个窗口（侧边栏 / 标签栏 / 终端都透出来），可选显示方式（完整显示 / 填充窗口 / 平铺）、背景不透明度、面板不透明度与背景模糊，改动实时预览、「保存设置」才生效；**启动** —— 开机自启（登录后静默进托盘，不弹窗口，即时生效）；**更新**；**关于**（版本、数据目录）。
- **检查更新**：设置里「检查更新」→ 下载 → 立即安装并重启；启动 10 秒后自动检查一次（只提示，不自动下载）。
- **标签**（v0.2）：一个会话可挂多个标签，左栏按标签分组（同一会话出现在它每个标签下，悬停时副本一起高亮，分组可折叠并记住）；顶部 chips 按「任一」（并集）/「全部」（交集）筛选；搜索框按名称或路径过滤（Ctrl+K 聚焦，终端里也生效）；路径条上直接加减标签，「管理标签」改名 / 换色 / 删除；新建会话时预选当前筛选的标签。数据在 `tags.json`。

## 安装

到 [Releases](https://github.com/nujabes226/tagterm/releases) 下载 `TagTerm-Setup-x.y.z.exe` 运行即可（安装包未签名，首次运行 SmartScreen 会提示）。要求 Windows 10 1809+。

数据只有三个 JSON 文件，都在 `%APPDATA%\TagTerm\`：`sessions.json`（会话）、`settings.json`（唤起命令与背景）、`tags.json`（标签与会话标签关联，创建第一个标签时生成）。卸载不会删除它们。

## 开发

```bat
pnpm install
pnpm dev          :: 开发模式（electron-vite，HMR）
pnpm test         :: vitest：main（node，含真实 cmd.exe 集成测试）+ renderer（happy-dom）
pnpm typecheck    :: vue-tsc + tsc
pnpm build        :: 打 nsis 安装包到 dist/（同时产出 latest.yml 与 .blockmap）
pnpm build:dir    :: 只出 dist/win-unpacked，不打安装包
```

无人值守烟测（真实起 Electron，跑完自动退出，结果以 `[smoke] {...}` JSON 打到 stdout；使用独立的 userData 与数据目录，不碰真实数据）：

```bat
set TAGTERM_SMOKE=1 && pnpm dev
```

### 技术栈

Electron 44 · Vue 3.5 + Pinia · TypeScript 5.9 · electron-vite 5 · node-pty 1.1 · @xterm/xterm 6 · electron-builder 26 · electron-updater 6 · Vitest 4。

### 结构

```
src/shared/     两进程共用：数据模型、IPC 契约（通道名 + 参数 / 返回类型）、window.tagterm 的类型
src/main/       主进程：装配（index）/ 接口层（ipc）/ 服务层（pty、store、updater）/ 平台层（window、tray）
src/preload/    contextBridge 暴露 SDK 风格的 window.tagterm
src/renderer/   Vue 渲染进程：stores（镜像主进程数据 + 筛选 UI 状态）、composables（分组算法等纯计算）、terminal（会话生命周期核心 + xterm 实例池）、components
tests/          与 src 对应的单元 / 集成测试
```

安全基线：`contextIsolation` + `sandbox`，无 Node 集成，CSP `script-src 'self'`；渲染进程只能通过 `window.tagterm` 里的函数与主进程交互，主进程对每个参数做类型守卫。

### 发布

1. 升 `package.json` 的 `version`，`pnpm build`。
2. 把 `dist/latest.yml`、`dist/TagTerm-Setup-x.y.z.exe`、`dist/TagTerm-Setup-x.y.z.exe.blockmap` 传到 GitHub Release（tag `vx.y.z`）。
3. 已安装的用户在「设置 → 检查更新」即可升级（更新源在 `electron-builder.yml` 的 `publish` 段，可改为任意静态文件地址）。

## 路线图

- ~~M2：标签~~ 已在 v0.2.0 交付
- M3：识别会话里正在运行的 AI 工具及其状态（运行中 / 等待你 / 已完成），托盘角标与系统通知
- M4：全局快捷键、拖拽排序、配置导入导出

## 许可

待定。
