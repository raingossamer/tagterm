# 数据库建表 SQL

> **本文档职责**：保存所有表的原生建表 SQL（DDL），含字段、类型、约束、索引、注释。
> 表关系文字说明见 `database-relations.md`；ER 图见 `data-er.md`。
> 由 `to-design` 生成（正向 0-to-1 / 逆向）、由 `design-doc-sync` 在 schema 变更时同步更新（含必要的迁移说明）。
> **「约定」章节例外**：它是数据库层的项目级代码规范，只由 `to-design` 首次建立，或由 `tdd` / `read-design-before-code` 列出规范候选、经你显式判定后写入；`design-doc-sync` 不改动它。
>
> **本项目映射**：TagTerm 不用数据库，SQL DDL **暂无**。本文档记录两份 JSON 文件的**精确结构**（TypeScript 类型 + 样例），它就是本项目的"schema"。生成于 2026-09-10（to-design 正向模式）。

## 约定（数据库代码规范）

> 与 `frontend.md` / `backend.md` 的「设计模式与约定」同性质。每条已填规范末尾以 `〔来源：…〕` 注明依据（现有 DDL / 迁移脚本路径 / 决策产物路径 / 手工约定）；逆向模式只写本项目证据，无证据处保留占位词。

- 存储介质：`%APPDATA%\TagTerm\` 下的 JSON 文件，不用数据库、不用 electron-store 〔来源：`tagterm-brief.md` §2 存储决策〕
- 每份文件顶层带整数 `version`；读取时 `version` 大于程序支持的版本 → 拒绝加载并提示升级；小于 → 逐版本迁移函数升级后写回 〔来源：`tagterm-brief.md` §3 "带版本号字段便于将来迁移"〕
- 写入原子性：先写同目录 `<文件>.tmp`，再 `rename` 覆盖；每次写整份文件，不做部分更新 〔来源：`tagterm-brief.md` §3 SessionStore〕
- 主键 `id`：uuid v4 字符串，由 `crypto.randomUUID()` 生成 〔来源：`tagterm-brief.md` §3 数据模型 `id: string; // uuid`〕
- 时间字段：ISO 8601 字符串（`new Date().toISOString()`），命名 `xxxAt`；`createdAt` 必备，其余按需 〔来源：`tagterm-brief.md` §3 `createdAt: string; // ISO`〕
- 字段命名 camelCase，与 TS 类型、IPC 载荷、渲染进程完全一致，无转换 〔来源：`tagterm-brief.md` §3 数据模型〕
- 可选字段缺省时**不写入**该键（TS `undefined` 不序列化），读取时按缺省处理 〔来源：JSON 社区基线草案，待确认〕
- 布尔字段不落盘（当前无）；状态类字段用字符串枚举而非数字 〔来源：JSON 社区基线草案，待确认〕
- 文件用 2 空格缩进美化输出，便于用户手工查看与备份 〔来源：JSON 社区基线草案，待确认〕
- 实体数组名用复数 camelCase（`sessions`、`tags`、`sessionTags`）〔来源：`Todo/Plans/tagterm-m1-plan.md` §3.1〕

> 与后端 / 前端字段的跨层命名对照见 `backend.md`「设计模式与约定」。

## 表：sessions（文件 `sessions.json`）

SQL DDL 暂无。结构（`src/shared/models.ts`）：

```ts
export type ShellKind = 'cmd.exe' | 'powershell.exe' | 'pwsh.exe';

export interface Session {
  id: string;            // uuid v4，主键
  name: string;          // 显示名，缺省取目录末段
  cwd: string;           // 固定工作目录，必填
  shell: ShellKind;      // 默认 cmd.exe
  startupCmd?: string;   // M4：打开会话后自动执行，如 "claude"
  lastAgent?: string;    // M3：最近唤起的工具
  sortOrder: number;     // 整数，越小越靠前
  createdAt: string;     // ISO 8601
  lastOpenedAt?: string; // ISO 8601，每次打开终端时更新
}

export interface SessionsFile {
  version: 1;
  sessions: Session[];
}
```

样例：

```json
{
  "version": 1,
  "sessions": [
    {
      "id": "6f1c2c4e-8f7a-4c1e-9b0e-2a3d5e7f9a11",
      "name": "simba-api",
      "cwd": "D:\\Projects\\simba\\api",
      "shell": "cmd.exe",
      "sortOrder": 1,
      "createdAt": "2026-09-10T08:00:00.000Z",
      "lastOpenedAt": "2026-09-10T09:12:31.000Z"
    }
  ]
}
```

## 表：tags / session_tags（文件 `tags.json`，M2）

SQL DDL 暂无。结构：

```ts
export interface Tag {
  id: string;         // uuid v4，主键
  name: string;       // 唯一
  color: string;      // TAG_COLORS 之一，#RRGGBB
  sortOrder: number;
}

export interface SessionTag {
  sessionId: string;  // → sessions[].id
  tagId: string;      // → tags[].id
}

export interface TagsFile {
  version: 1;
  tags: Tag[];
  sessionTags: SessionTag[];   // (sessionId, tagId) 联合唯一
}
```

样例：

```json
{
  "version": 1,
  "tags": [
    { "id": "b2e5…", "name": "simba", "color": "#2F6FDB", "sortOrder": 1 },
    { "id": "c9a1…", "name": "java",  "color": "#C98A0C", "sortOrder": 2 }
  ],
  "sessionTags": [
    { "sessionId": "6f1c2c4e-…", "tagId": "b2e5…" },
    { "sessionId": "6f1c2c4e-…", "tagId": "c9a1…" }
  ]
}
```

## 迁移记录

| 日期 | 变更 | 影响 | 备注 |
|------|------|------|------|
| 2026-09-10 | 定义 `sessions.json` v1（M1）与 `tags.json` v1（M2） | 无存量数据 | 文件不存在视为空集合，首次写入时创建目录与文件 |
