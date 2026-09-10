# 数据库关系文档

> **本文档职责**：用文字说明各表之间的关系与基数（一对一 / 一对多 / 多对多），以及外键、级联、关键约束。
> 可视化 ER 图见 `data-er.md`（Mermaid erDiagram）；建表语句见 `sql.md`。
> 由 `to-design` 生成（正向 0-to-1 / 逆向）、由 `design-doc-sync` 在实体 / schema 变更时同步更新。
>
> **本项目映射**：TagTerm 不用数据库，持久化是 `%APPDATA%\TagTerm\` 下两份 JSON 文件（`tagterm-brief.md` §2 已定）。本文档把"表"理解为 JSON 文件中的实体数组，"外键"是数组元素之间的 id 引用，"级联"由 `SessionStore` 在代码中保证。运行时状态（agent、status、pty 存活、滚动缓冲）**不落盘**，不在本文档范围。
> 生成于 2026-09-10（to-design 正向模式）。

## 表清单

| 表名（实体数组） | 所在文件 | 说明 | 里程碑 |
|------|------|------|------|
| sessions | `sessions.json` → `sessions[]` | 会话：一个固定工作目录的终端定义 | M1 |
| tags | `tags.json` → `tags[]` | 标签 | M2 |
| session_tags | `tags.json` → `sessionTags[]` | 会话与标签的多对多关联 | M2 |

两份文件都带顶层 `version` 整数字段，便于将来迁移。`sessionTags` 与 `tags` 放同一文件，删除标签时一次原子写即可保证一致。

## 关系说明

| 主表 | 从表 | 基数 | 外键 | 级联策略 | 说明 |
|------|------|------|------|---------|------|
| sessions | session_tags | 1 : N | `sessionTags[].sessionId → sessions[].id` | 删除会话时由 `SessionStore.remove` 删除其全部关联（代码级 CASCADE） | 一个会话可挂多个标签 |
| tags | session_tags | 1 : N | `sessionTags[].tagId → tags[].id` | 删除标签时由 `SessionStore.removeTag` 删除其全部关联，**会话保留**（原型文案「会话本身会保留」） | 一个标签下有多个会话 |

跨文件引用：`sessionTags[].sessionId` 指向另一份文件里的会话。加载时对悬空引用（会话已不存在）做清理并记录日志，不报错。

## 多对多关系

| 中间表 | 关联 A | 关联 B | 说明 |
|--------|--------|--------|------|
| session_tags | sessions | tags | 会话 ↔ 标签多对多。左栏按标签分组显示时，同一会话出现在它所有标签的分组下；筛选「任一」= 并集，「全部」= 交集 |

## 关键约束与索引

JSON 没有索引；以下约束由 `SessionStore` 在写入前校验：

| 约束 | 作用对象 | 说明 |
|------|---------|------|
| 唯一 | `sessions[].id` | uuid v4，创建时生成 |
| 唯一 | `tags[].id` | uuid v4 |
| 唯一 | `tags[].name` | 同名创建返回已有标签（原型 `createTag` 行为）；改名撞名则拒绝 |
| 联合唯一 | `sessionTags (sessionId, tagId)` | 重复 attach 幂等 |
| 非空 | `sessions[].cwd` | 目录必填（原型「需要一个目录」） |
| 非空 | `sessions[].name` | 缺省取目录末段，落盘时一定有值 |
| 排序 | `sessions[].sortOrder`、`tags[].sortOrder` | 整数，越小越靠前；新建取最大值 + 1；M4 拖拽排序整体重写 |

不校验 `cwd` 是否存在于磁盘：目录被删后会话仍保留，打开终端时 spawn 失败在终端内提示。

## 枚举值

| 表.字段 | 取值 | 含义 |
|---------|------|------|
| sessions.shell | `cmd.exe` / `powershell.exe` / `pwsh.exe` | 终端壳，默认 `cmd.exe`（`pwsh.exe` 备选，简报待确认区默认 cmd） |
| sessions.lastAgent | `claude` / `gemini` / `codex`（是否加 `pi` 待确认） | 最近唤起的工具，M3 写入 |
| tags.color | 原型 `TAG_COLORS` 八色之一：`#2F6FDB` `#2A9D5C` `#C98A0C` `#7B4FD1` `#D14343` `#1E9BA8` `#C8449A` `#6B7280` | 新建按顺序轮转；管理标签里点击色块按此顺序换色 |

不落盘的运行时枚举（仅供对照）：`AgentStatus = idle / working / blocked / done`，定义在 `shared/models.ts`，见 `backend.md`。

## 待确认问题

1. `sessions.lastAgent` / `AgentKind` 是否加入 `pi`（与 `backend.md` 待确认 #2 同一决策）。
2. 悬空 `sessionTags` 引用的处理：推荐加载时静默清理并写日志；是否需要在界面提示？
