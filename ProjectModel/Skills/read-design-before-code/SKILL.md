---
name: read-design-before-code
description: "Read design docs, including their coding-convention sections (frontend.md / backend.md「设计模式与约定」, sql.md「约定」), before editing backend or frontend code, to ensure the implementation matches both the documented architecture and the project code style. Already embedded in /tdd; use standalone for any backend/frontend code change outside the TDD flow, including editing or modifying code in api/service/mapper/entity/views/components/router/store."
argument-hint: "Scope of changes, e.g. 'backend api', 'frontend page', 'full-stack'"
user-invocable: true
disable-model-invocation: false
---

# Read Design Before Code

## Pipeline Position

```
[主流水线] grill-me-with-design → write-a-spec → spec-to-plan → tdd → design-doc-sync
                                                              │
                                              read-design-before-code（旁路工具，已内嵌于 tdd 每片的 READ 步骤，GREEN 之前）
```

> 四条路径全景（权威图）见 `ProjectModel/README.md`「开发流水线」；上图仅示意本 Skill 的位置。

本 Skill **不在主开发流水线上**，是一个**旁路工具型 Skill**：
- 在 `tdd` 流程中，每个切片的 READ 步骤（GREEN 之前）会**自动执行**它，无需手动调用。
- 仅当进行**非 TDD 流程**的零散代码修改（如小 Bug 修复、独立重构）时，才需要手动触发。

## Goal

Before editing backend or frontend code, read the current design documents first — **including their coding-convention sections**（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」）— then implement changes based on the documented architecture, boundaries and code style.

> **注意**：此 Skill 已内置于 `/tdd` 流程中，在每个切片的 READ 步骤（GREEN 之前）自动执行。仅在非 TDD 流程的代码修改中需要手动调用。

## Required Reads

1. ProjectModel/Design/backend.md
2. ProjectModel/Design/frontend.md
3. ProjectModel/Design/database/database-relations.md
4. ProjectModel/Design/database/data-er.md
5. ProjectModel/Design/database/sql.md

> 每份文档含两类**正交**章节：架构章节约束"做什么、边界在哪"；规范章节（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」）约束"代码怎么写"。按变更范围读文档时**两类都读**，缺任一类，实现都可能"架构对但风格错"或"风格对但越界"。
> 规范章节中仍含占位词（`示例：` / `待确认` 等）的条目视为**未决**，不得当作既定规范；如本次改动正好触及该未决点，向用户确认一次再落笔。该裁决**不自动写入**：改码完成后作为规范候选交用户显式判定是否写入（见 Procedure 第 6 步）。

## When To Use

Use this skill whenever the task includes any of the following:

1. Modify backend Java code (api/service/mapper/entity/config/security).
2. Modify frontend Vue/TS code (views/components/router/store/api).
3. Change frontend-backend API contracts.
4. Refactor existing backend or frontend modules.

## Procedure

1. Determine change scope: backend / frontend / database / both.
2. Before any code edit:
   - If backend scope exists, read `ProjectModel/Design/backend.md`.
   - If frontend scope exists, read `ProjectModel/Design/frontend.md`.
   - If database scope exists, read `ProjectModel/Design/database/database-relations.md`, `ProjectModel/Design/database/data-er.md` and `ProjectModel/Design/database/sql.md`.
   - **Always read the coding-convention section** of each doc you read（「设计模式与约定」/「约定」）— layering, exception & response shape, logging, naming, cross-layer naming.
3. Extract relevant constraints: from the architecture sections — module boundary, API path, data flow; from the convention sections — layering duties, exception & response shape, logging, naming conventions.
4. Implement code changes according to those constraints.
5. If implementation must differ from design, record and explain the delta.
6. **规范候选判定**：若本次改动裁决了规范章节的待确认项，或首次引入了规范章节未覆盖的**项目级**写法约定，列出候选并**询问用户是否写入**对应 Design 文档的规范章节（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」）。同意 → 写入对应小节并附 `〔来源：{本次改动说明 / 关联 issue}〕`；不同意 → 不写，仅在报告中记为局部决定。模块内的写法不是候选，归该文档的架构章节由 sync 同步。**只有用户显式判定才可写入规范章节**。
7. 改码完成后，**自动衔接执行 `design-doc-sync`**（无需用户再次触发）：按其 Update Matrix 只同步受影响的设计文档，并输出 Delta & 人工动作清单（零散改动多数类为"无"，但配置/字段类变更正是清单要兜住的）。`design-doc-sync` 只同步架构章节，不改动规范章节。

## Completion Checklist

- [ ] Backend changes were preceded by reading `ProjectModel/Design/backend.md`.
- [ ] Frontend changes were preceded by reading `ProjectModel/Design/frontend.md`.
- [ ] Database changes were preceded by reading `ProjectModel/Design/database/` docs.
- [ ] The coding-convention sections were read and the implementation follows them (naming, layering, exception/response, logging).
- [ ] API contract changes are consistent with both docs.
- [ ] Any design-vs-code delta is explicitly documented.
- [ ] 规范候选（如有）已交用户显式判定；规范章节仅按用户同意写入并附来源。
- [ ] 改码完成后已自动衔接执行 design-doc-sync（同步受影响文档 + Delta & 人工动作清单）。

## Final Output Requirement

When finishing a code task, include a short pre-read report:

1. Which design docs (and their convention sections) were read before coding.
2. Which constraints were applied (architecture constraints and coding conventions).
3. Any deviation from current design docs and why.
4. 规范候选（如有）及用户裁决结果：已写入规范章节哪几条 / 哪几条作为局部决定不写入。
