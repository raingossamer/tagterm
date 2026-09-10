# 前端设计文档

> **本文档职责**：记录前端架构、技术栈、目录结构、路由、组件层级、状态管理与 API 调用层（架构章节），以及前端**项目级代码规范**（「设计模式与约定」章节）。
> 架构章节由 `to-design` 生成（正向 0-to-1 / 逆向）、由 `design-doc-sync` 在每轮开发收尾时同步更新。
> **「设计模式与约定」章节例外**：它是项目级代码规范，只由 `to-design` 首次建立，或由 `tdd` / `read-design-before-code` 列出规范候选、经你显式判定后写入；`design-doc-sync` 不改动它。
> 是 `grill-me-with-design` / `write-a-spec` / `tdd`（GREEN 阶段）读取的约束源之一。
>
> **本项目映射**：本文档的"前端" = **Electron 渲染进程**（Vue 3）。`tagterm-prototype.html` 是布局、分组逻辑、筛选语义、标签页行为、路径条、状态点颜色与文案的**唯一标准**，本文档只描述结构与数据流，具体像素与文案以原型为准。
> 生成于 2026-09-10（to-design 正向模式），依据：`tagterm-brief.md`、`tagterm-prototype.html`、`ProjectModel/Todo/Plans/tagterm-m1-plan.md`，以及用户当日结论：**终端进程只在应用运行期间存活，退出后不恢复**。

## 技术栈

| 项 | 选型 |
|----|------|
| 运行壳 | Electron 44.3 渲染进程；`contextIsolation` + `sandbox`，无 Node 集成 |
| 框架 | Vue 3.5 + TypeScript 5.9，`<script setup>` + Composition API |
| 构建 | electron-vite 5（Vite 7） |
| UI 库 | 无；直接复用原型的 CSS（`styles/tokens.css` 变量 + `styles/base.css` 全局样式） |
| 状态管理 | Pinia 4 |
| 路由 | 无（单窗口） |
| 终端渲染 | @xterm/xterm 6.0 + addon-fit 0.11 / addon-webgl 0.19 / addon-search 0.16 / addon-unicode11 0.9 |
| 请求库 | 无 HTTP；全部通过 preload 暴露的 `window.tagterm`（SDK 风格）走 IPC |
| 测试 | Vitest 4 + Vue Test Utils 2 + happy-dom |

## 目录结构

```
src/renderer/
├── index.html                   # 含 CSP meta
└── src/
    ├── main.ts                  # createApp + Pinia + 全局样式
    ├── App.vue                  # 双栏布局 .app（296px | 1fr），side-hidden 切换，全局快捷键（Ctrl+K、Esc）
    ├── env.d.ts                 # declare window.tagterm: TagTermApi
    ├── styles/
    │   ├── tokens.css           # 原型 :root 变量原样搬入（--bg / --panel / --st-* / --t-* / --font / --mono）
    │   └── base.css             # 原型全局样式（reset、focus-visible、.btn、.dot、.chip 等公共类）
    ├── stores/
    │   ├── sessions.ts          # 会话列表镜像 + CRUD action（M1）
    │   ├── workspace.ts         # openTabs / activeId / sideHidden / 每会话运行态（M1）
    │   ├── tags.ts              # 标签与关联镜像 + action（M2）
    │   ├── filter.ts            # 筛选：选中标签、任一/全部、搜索词、分组折叠（M2）
    │   └── agent.ts             # 每会话 agent / status 运行时镜像（M3）
    ├── terminal/
    │   ├── TerminalPool.ts      # xterm 实例池（纯 TS 类，见「核心页面与组件」）
    │   └── theme.ts             # 终端配色（Windows Campbell）、字体栈、默认选项
    ├── composables/
    │   ├── useSessionGroups.ts  # 分组 / 筛选 / 搜索的纯计算（M2；M1 为单组平铺）
    │   └── useCopy.ts           # 复制路径 + 「已复制」1.2 s 反馈
    └── components/
        ├── SideHead.vue         # 品牌行 + 搜索框（搜索 M2）
        ├── TagFilter.vue        # 标签 chips + 任一/全部 + 清除（M2）
        ├── SessionGroups.vue    # 按标签分组的会话列表；M1 单组平铺
        ├── SessionRow.vue       # 一行会话：状态点、名称、路径末两段、标签色点
        ├── SideFoot.vue         # 「新建会话」「管理标签」（后者 M2）
        ├── TabBar.vue           # ☰ / 标签页 / ＋
        ├── PathStrip.vue        # 路径、复制、标签胶囊（M2）、+ 标签（M2）、唤起区、清屏、移除会话
        ├── TerminalPane.vue     # 实例池容器 + ResizeObserver
        ├── StatusBar.vue        # 会话数、三项状态计数、版本
        ├── EmptyState.vue       # 「选一个会话开始」
        ├── NewSessionModal.vue  # 名称 / 目录（浏览…）/ Shell / 标签（M2）
        ├── TagPopover.vue       # 给会话加减标签的弹出层（M2）
        ├── ManageTagsModal.vue  # 改名、换色、删除、新建标签（M2）
        └── StatusDot.vue        # `.dot` 四态（idle / working / blocked / done）
```

`src/shared/`（`models.ts`、`ipc.ts`、`api.ts`）由两进程共用，渲染进程只 import 类型与常量。

## 路由结构

暂无。单窗口应用没有 URL 路由；右侧区域在「空状态」与「终端工作区（TabBar + PathStrip + TerminalPane）」之间切换，由 `workspace.activeId` 是否为空决定。

| 路径 | 页面 / 组件 | 说明 | 是否需登录 |
|------|------------|------|-----------|
| 暂无 | — | — | — |

## 核心页面与组件

### 布局（照原型）

```
.app（grid 296px | 1fr；.side-hidden → 0 | 1fr）
├── aside.side
│   ├── SideHead      品牌「TagTerm　会话即路径，标签可交叉」+ 搜索框（M2，Ctrl+K 聚焦）
│   ├── TagFilter     「按标签筛选」+ 任一/全部 分段 + 清除 + 标签 chips（M2；M1 不渲染）
│   ├── SessionGroups 可滚动分组列表
│   └── SideFoot      「新建会话」primary、「管理标签」（M2；M1 不渲染）
└── main.main
    ├── TabBar
    ├── 有 activeId → .work：PathStrip + TerminalPane
    │   无 activeId → EmptyState
    └── StatusBar
弹层：NewSessionModal、ManageTagsModal（M2）、TagPopover（M2，绝对定位在「+ 标签」按钮下方）
```

### 组件说明

| 组件 | 职责与交互（以原型为准） | 数据来源 / 通信 | 里程碑 |
|------|------------------------|----------------|--------|
| App | 布局容器；`provide` TerminalPool 单例；全局 keydown：Ctrl+K 聚焦搜索（M2）、Esc 关闭弹层 | `workspace.sideHidden` | M1 |
| SessionGroups | 按 `useSessionGroups` 的结果渲染分组：分组头（三角、色点、名称、数量，点击折叠）；组内无会话显示「这个标签下还没有会话」；整体无匹配显示「没有匹配的会话。换个标签组合，或新建一个会话。」。M1 只有一个无分组头的平铺组 | `sessions`、`tags`（M2）、`filter`（M2）、`agent`（M3） | M1 / M2 |
| SessionRow | 状态点 + 名称 + 路径末两段（mono）+ 右侧标签色点；tooltip 为完整路径，多标签时追加「同时在：a、b」；hover 时同一会话的**所有副本**一起高亮（`peer`）；active 行左侧 3 px 蓝条；点击 → `workspace.select(id)` | props: session、tags、status；emit: select、hover | M1 / M2 |
| TagFilter | 每个标签一个 chip（色点 + 名 + 会话数），点击切换选中；「任一 / 全部」分段；有选中时显示「清除」；无标签时提示「还没有标签，在"管理标签"里创建」 | `filter`、`tags` | M2 |
| TabBar | 最左 ☰ 收起 / 展开左栏；每个标签页：状态点 + 会话名 + ×（tooltip「关闭标签页（会话继续在后台保持）」）；最右 ＋ 打开新建弹窗；Enter / Space 可选中 | `workspace.openTabs / activeId`、`agent`（M3） | M1 |
| PathStrip | 路径 chip（tooltip「会话固定在这个目录」；M3 起显示追踪到的当前目录 `cwdNow`）、「复制」→「已复制」1.2 s；标签胶囊带 ×（M2）；「+ 标签」打开 TagPopover（M2）；右侧唤起区：M1 固定显示「唤起」+ `claude / gemini / codex` mono 按钮；M3 有 agent 时改为「当前：Claude Code，运行中」+「退出 Claude Code」；「清屏」；「移除会话」danger（confirm 文案 `移除会话 "x"？终端进程会被结束。`） | `sessions`、`workspace`、`tags`（M2）、`agent`（M3）；唤起 / 清屏 = `tagterm.pty.write(id, '<cmd>\r')` | M1 / M2 / M3 |
| TerminalPane | 提供 `position: relative; flex: 1; min-height: 0` 的容器给 TerminalPool；ResizeObserver → `pool.fitActive()`；点击空白处聚焦当前终端 | inject TerminalPool | M1 |
| StatusBar | 「N 个会话」、三个计数（运行中 / 等待你 / 已完成未查看，M1 为 0）、右侧显示应用版本（替代原型的"数据只在内存里"提示） | `sessions`、`agent`（M3）、`tagterm.app.getVersion()` | M1 / M3 |
| EmptyState | 原型三行文案 | — | M1 |
| NewSessionModal | 字段：名称（占位「例如 simba-api」）、目录（mono，占位 `D:\Projects\...`，旁加「浏览…」调 `session.pickDirectory`）、Shell 下拉（默认 cmd.exe；只列可用 shell）、标签 chips + 「新标签名，回车添加」（M2；打开时预选当前筛选的标签）；目录为空 → 占位改「需要一个目录」并聚焦；名称为空取目录末段；Enter 提交（新标签输入框除外）；「创建并打开」后立即选中该会话 | emit: created；调用 `sessions.create` | M1 / M2 |
| TagPopover | 列出全部标签，已加的显示 ✓，点击切换；底部输入「新标签名，回车创建并加上」；点击外部或 Esc 关闭 | `tags`；`tags.attach / detach / create` | M2 |
| ManageTagsModal | 每行：色块（点击按 `TAG_COLORS` 轮转换色）、可编辑名称（清空则还原）、「N 个会话」、「删除」（confirm `删除标签 "x"？会话本身会保留。`）；底部「新标签名，回车添加」；「完成」关闭 | `tags` | M2 |
| StatusDot | `.dot.idle`（灰空心）/ `.working`（绿实心）/ `.blocked`（黄实心 + 脉冲，reduced-motion 关闭）/ `.done`（蓝实心） | props: status | M1（样式）/ M3（数据） |

### 关键交互规则

- **选中会话** `workspace.select(id)`：不在标签页里则追加；设为 active；`pool.open(session)` 后 `pool.show(id)`；M3 起若状态为 done 则调 `agent.markViewed(id)`（done → idle）。
- **关闭标签页** `workspace.closeTab(id)`：从 `openTabs` 移除；若关的是当前页，激活 `openTabs[min(i, len-1)]`，全关则 activeId = null（空状态）。**不结束 pty、不销毁 xterm 实例。**
- **移除会话**：确认后 `sessions.remove(id)`；主进程 kill pty 并广播；渲染进程 `pool.dispose(id)`、`workspace.onSessionRemoved(id)`（关其标签页、必要时切换 active）。
- **pty 退出**：`pty.onExit` → 该实例末尾写 `[进程已退出，代码 N]`，`workspace.runtime[id].alive = false`；再次选中该会话或在其终端按回车 → `pool.dispose(id)` + `pool.open(session)` 重新 spawn（默认方案，见 backend.md 待确认 #8）。
- **分组与筛选**（M2，`useSessionGroups`，与原型 `buildGroups` 等价）：先按搜索词过滤（名称或路径包含，大小写不敏感）；无筛选 → 每个标签一组 + 「未打标签」组（仅有内容时显示）；「任一」筛选 → 只显示选中的标签各一组；「全部」筛选 → 单组，标题为 `A ∩ B`，内容为同时含所有选中标签的会话。同一会话出现在它所有标签的组下。折叠状态按分组 key 记忆。
- **搜索**（M2）：Ctrl+K 聚焦并全选搜索框；输入即过滤，不改分组模式。
- **侧栏收起**：`.app.side-hidden` 把左列宽度设为 0；宽度变化经 ResizeObserver 触发终端 fit。

### xterm 实例池（`terminal/TerminalPool.ts`）

一个会话一个 `Terminal`，与 pty 同寿命；所有实例挂在 TerminalPane 的同一容器里，各自一个绝对定位 host；切换只切 `display`，**禁止**用一个 Terminal 反复重灌数据。规则：

1. `open(session)` 幂等：无实例 → 创建（Unicode11 → `unicode.activeVersion = '11'`；fit；search）→ `term.open(host)` → fit 得 cols / rows → `tagterm.pty.open(id, size)`；有实例不动。
2. `show(id)`：其余 host `display: none`，目标 `display: block`，`requestAnimationFrame` 后 `fit()` + `focus()`；WebGL addon 只挂在当前可见实例（Chromium WebGL 上下文约 16 个上限），切换时从旧实例 dispose、给新实例加载；`onContextLoss` → dispose 回退 DOM 渲染器。
3. `fit()` 只对可见实例执行（`display: none` 下量不到尺寸）；`term.onResize` 才发 `pty.resize`，保证 pty 尺寸等于可见终端尺寸。
4. 全池只订阅一次 `pty.onData` / `pty.onExit`，按 sessionId 路由到对应实例；`term.onData` → `pty.write`。
5. `dispose(id)`：取消订阅、`term.dispose()`、移除 host。渲染进程整页重载后不回放历史输出。
6. 默认选项（`theme.ts`）：字体栈 `"Cascadia Mono", Consolas, "Microsoft YaHei", monospace`、`fontSize 14`、`scrollback 5000`、`cursorBlink`、`windowsPty: { backend: 'conpty', buildNumber }`、Campbell 配色（bg `#0C0C0C` / fg `#CCCCCC` / green `#16C60C` / yellow `#F9F1A5` / red `#E74856` / cyan `#61D6D6` / blue `#3B78FF`，与原型 `--t-*` 一致）。

组件通信方式：父子用 props / emit；跨组件共享走 Pinia；TerminalPool 单例用 `provide / inject`（App 提供，TerminalPane 与 PathStrip 注入）。

## 状态管理

| Store | State | Getter | Action | 数据流 | 里程碑 |
|-------|-------|--------|--------|--------|--------|
| `sessions` | `sessions: Session[]` | `byId(id)`、`count` | `load()`、`create(input)`、`update(id, patch)`、`remove(id)` | 启动 `tagterm.session.list()`；订阅 `session.onChanged` 全量替换；action 只调 SDK，不本地改数组 | M1 |
| `workspace` | `openTabs: string[]`、`activeId: string \| null`、`sideHidden: boolean`、`runtime: Record<id, { alive: boolean; exitCode?: number }>` | `activeSession`、`isOpen(id)` | `select(id)`、`closeTab(id)`、`onSessionRemoved(id)`、`toggleSide()`、`setExited(id, code)` | 纯 UI 状态，只在渲染进程；订阅 `pty.onExit` | M1 |
| `tags` | `tags: Tag[]`、`sessionTags: SessionTag[]` | `byId`、`tagsOf(sessionId)`、`countOf(tagId)` | `create(name)`、`rename`、`recolor`、`remove`、`attach(sid, tid)`、`detach(sid, tid)` | 订阅 `tag.onChanged` 全量替换 | M2 |
| `filter` | `selected: Set<tagId>`、`mode: 'any' \| 'all'`、`search: string`、`collapsed: Set<groupKey>` | `visibleSessions`、`groups`（经 `useSessionGroups`） | `toggle(tid)`、`clear()`、`setMode`、`setSearch`、`toggleCollapsed(key)` | 纯 UI 状态；`collapsed` 持久化位置见待确认 #1 | M2 |
| `agent` | `runtime: Record<id, SessionRuntime>` | `statusOf(id)`、`countBy(status)` | `load()`、`markViewed(id)` | 启动 `agent.list()`；订阅 `agent.onStatus` 逐条更新 | M3 |

原则：持久数据（会话、标签、关联）的真相源在主进程，渲染进程 store 只镜像广播；UI 状态（标签页、active、侧栏、筛选、折叠）只在渲染进程。

## API 调用层

无 HTTP。渲染进程唯一的出口是 preload 暴露的 `window.tagterm`（类型 `shared/api.ts` 的 `TagTermApi`），SDK 风格：每个操作一个具体函数，测试时按函数 mock。invoke 失败以 rejected Promise 返回，调用处 catch 后在界面内联提示（弹窗内红字或状态栏右侧），不做全局拦截器。

| 前端方法 | 对应 IPC 通道 | 说明 | 里程碑 |
|---------|------------|------|--------|
| `tagterm.app.getVersion()` | `app:get-version` | 状态栏版本 | M1 |
| `tagterm.session.list()` | `session:list` | 启动加载 | M1 |
| `tagterm.session.create(input)` | `session:create` | 新建 | M1 |
| `tagterm.session.update(id, patch)` | `session:update` | 改名 / 换 shell / startupCmd | M1 |
| `tagterm.session.remove(id)` | `session:remove` | 移除（含 kill pty） | M1 |
| `tagterm.session.pickDirectory()` | `session:pick-directory` | 系统目录选择框 | M1 |
| `tagterm.session.onChanged(cb)` | 事件 `session:changed` | 返回取消订阅函数 | M1 |
| `tagterm.pty.open(id, size)` | `pty:open` | 幂等打开 | M1 |
| `tagterm.pty.write(id, data)` | `pty:write`（send） | 键入 / 唤起 / 清屏 | M1 |
| `tagterm.pty.resize(id, size)` | `pty:resize` | 由 `term.onResize` 触发 | M1 |
| `tagterm.pty.kill(id)` | `pty:kill` | 手动结束 | M1 |
| `tagterm.pty.isAlive(id)` | `pty:is-alive` | 重启前判断 | M1 |
| `tagterm.pty.onData(cb)` / `onExit(cb)` | 事件 `pty:data` / `pty:exit` | 池内各订阅一次 | M1 |
| `tagterm.tag.list()` / `create` / `update` / `remove` | `tag:*` | 标签 CRUD | M2 |
| `tagterm.tag.attach(sid, tid)` / `detach(sid, tid)` | `session-tag:*` | 多对多关联 | M2 |
| `tagterm.tag.onChanged(cb)` | 事件 `tag:changed` | 全量替换 | M2 |
| `tagterm.agent.list()` / `markViewed(id)` | `agent:list` / `agent:mark-viewed` | 运行时状态 | M3 |
| `tagterm.agent.onStatus(cb)` | 事件 `agent:status` | 逐条更新 | M3 |
| `tagterm.session.reorder(ids)` | `session:reorder` | 拖拽排序 | M4 |
| `tagterm.app.exportConfig()` / `importConfig()` | `app:export-config` / `app:import-config` | 配置导入导出（格式待确认） | M4 |

## 设计模式与约定（前端代码规范）

> 本章节约束"代码怎么写"，与上文架构章节的"做什么、边界在哪"正交。每条已填规范末尾以 `〔来源：…〕` 注明依据：配置文件路径 / 代表性源码路径（抽样 n/m）/ 决策产物路径（Grill、Plan、RFC）/ 手工约定。没有来源的条目视为待核实。
> 逆向模式只写本项目代码与配置的证据，无证据处保留占位词，禁止用社区惯例填充。多种写法并存的项记入「待确认问题」待裁决。
>
> **状态说明（2026-09-10）**：来源写 `tagterm-brief.md` / 原型 / Plan 的条目已定；来源写 `Vue 3 社区基线草案，待确认` 的条目是正向模式按社区基线草拟的，**等你一次性确认**后我把来源改为 `社区基线，用户确认 <日期>`；在此之前 `tdd` 会把它们视为未决。

### 架构级模式

- 加载态 / 错误态：无全局拦截器；SDK 调用在触发处 `try / catch`，错误在所在弹窗或状态栏内联显示；列表加载失败显示在左栏空态区 〔来源：Vue 3 社区基线草案，待确认〕
- 组件通信：父子 props / emit；跨组件共享走 Pinia；`provide / inject` 只用于注入 TerminalPool 单例 〔来源：`Todo/Plans/tagterm-m1-plan.md` §1、§4〕
- 渲染进程不直接碰 Node / Electron API，只用 `window.tagterm` 〔来源：`tagterm-brief.md` §3 preload〕
- 一个会话一个 xterm 实例，切换只切 display，不重灌 〔来源：`tagterm-brief.md` §3 xterm 实例池〕

### 代码格式化

- Prettier 3：2 空格缩进、单引号、无分号、行宽 100、尾逗号 `all`（create-vue 默认风格）〔来源：Vue 3 社区基线草案，待确认〕
- ESLint 9 flat config：`eslint-plugin-vue` flat/recommended + `typescript-eslint` recommended；提交前无 error 〔来源：Vue 3 社区基线草案，待确认〕
- 类型检查用 `vue-tsc --noEmit`，`strict` 开启 〔来源：`Todo/Plans/tagterm-m1-plan.md` §2〕

### 组件风格

- 统一 `<script setup lang="ts">` + Composition API；SFC 块顺序 script → template → style 〔来源：Vue 3 社区基线草案，待确认〕
- Props / emits 用类型声明式 `defineProps<{...}>()` / `defineEmits<{...}>()`；可选 props 用 `withDefaults` 〔来源：Vue 3 社区基线草案，待确认〕
- 纯逻辑抽到 `composables/`（返回值而非改入参）或 `terminal/` 的纯 TS 类；组件只负责渲染与事件转发 〔来源：`Todo/Plans/tagterm-m1-plan.md` §1 分层规则〕
- 测试用 `data-test="..."` 选择元素，不按 class 断言 〔来源：Vue 3 社区基线草案，待确认〕

### 样式约定

- 组件内 `<style scoped>`；跨组件公共类（`.btn`、`.dot`、`.chip`、`.field`）放 `styles/base.css` 〔来源：Vue 3 社区基线草案，待确认〕
- 设计变量全部用原型的 CSS 变量（`--bg`、`--panel`、`--accent`、`--st-*`、`--t-*`、`--font`、`--mono`），不写裸色值 〔来源：`tagterm-prototype.html` `:root`〕
- 类名沿用原型的短类名（`.row`、`.tab`、`.strip`、`.group-h`），不引入 BEM，保证与原型 CSS 可直接对照 〔来源：`tagterm-brief.md` §1 "全部照它实现"〕
- 界面文案中文，与原型一字不差；缺失文案先问再补 〔来源：`tagterm-brief.md` §2 语言、§6.4〕

### 目录与模块组织

- 所有 IPC 调用只经 `window.tagterm`；组件可直接调用 SDK，但涉及 store 状态的操作走 store action 〔来源：`Todo/Plans/tagterm-m1-plan.md` §3.3〕
- 共享类型只从 `src/shared/` import；渲染进程不定义与之重复的类型 〔来源：`Todo/Plans/tagterm-m1-plan.md` §1〕
- 公共逻辑：纯计算放 `composables/`，与 DOM / xterm 相关的有状态逻辑放 `terminal/` 〔来源：Vue 3 社区基线草案，待确认〕

### 注释

- 注释中文；组件顶部一句话说明职责；非显然逻辑（分组算法、fit 时机、WebGL 迁移）必注释；标识符英文 〔来源：`tagterm-brief.md` §2 语言决策〕

### 命名约定

| 对象 | 规范 | 举例 |
|------|------|------|
| 常量 | 全大写 + 下划线 〔来源：`tagterm-prototype.html` `TAG_COLORS`〕 | `TAG_COLORS` |
| 布尔变量 | is / has / can 前缀 〔来源：Vue 3 社区基线草案，待确认〕 | `isOpen` |
| 组件文件 / 组件名 | PascalCase，多词 〔来源：`Todo/Plans/tagterm-m1-plan.md` §1〕 | `SessionGroups.vue` |
| 变量 / 函数 | camelCase 〔来源：Vue 3 社区基线草案，待确认〕 | `selectSession` |
| 组合式函数 | `use` 前缀 〔来源：Vue 3 社区基线草案，待确认〕 | `useSessionGroups` |
| Pinia store | 文件 camelCase 名词，导出 `useXxxStore` 〔来源：Vue 3 社区基线草案，待确认〕 | `stores/workspace.ts` → `useWorkspaceStore` |
| 事件名 | script 内 camelCase 声明，模板中 kebab-case 监听 〔来源：Vue 3 社区基线草案，待确认〕 | `emit('selectSession')` / `@select-session` |
| CSS 类名 | 沿用原型短类名，小写连字符 〔来源：`tagterm-prototype.html`〕 | `.group-h`、`.side-foot` |
| 路由路径 | 暂无 | — |

> 与主进程 / JSON 文件字段的跨层命名对照见 `backend.md`「设计模式与约定」：四层共用一份 camelCase 类型，无转换。

## 待确认问题

1. **分组折叠状态的持久化位置**（简报 M2「折叠状态记忆」）：推荐渲染进程 `localStorage`（纯 UI 偏好，不进 `tags.json`）。—— M2
2. **唤起按钮列表是否加入 `pi`**（用户 2026-09-10 提到；本机已装 claude / gemini / pi，未装 codex）：推荐可配置列表 + 启动时探测 PATH，未安装的不显示。与 `backend.md` 待确认 #2 同一决策。—— M1
3. **M1 隐藏标签相关 UI**（搜索框、筛选区、标签色点、+ 标签、管理标签），M2 一并加回 —— 默认按 Plan §9 #4 推荐执行。—— M1
4. **状态栏三项计数 M1 显示 0** 保持原型布局 —— 默认按 Plan §9 #5 推荐执行。—— M1
5. **PathStrip 的路径显示**：M3 起显示追踪到的 `cwdNow` 还是固定 cwd + 另起一段显示当前目录？推荐直接显示 `cwdNow`（缺省回落到固定 cwd），tooltip 保留固定目录。—— M3
6. **pty 退出后的重启方式** —— 默认按 backend.md 待确认 #8。—— M1
