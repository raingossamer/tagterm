---
name: design-doc-sync
description: "Sync design docs after feature work, bug fixes, or refactors. Must check and update ProjectModel/Design/backend.md, ProjectModel/Design/frontend.md, ProjectModel/Design/database/database-relations.md, ProjectModel/Design/database/data-er.md, and ProjectModel/Design/database/sql.md. Use when: adding a feature, modifying backend/frontend code, or changing an entity or database schema."
argument-hint: "Scope of changes, e.g. 'backend api + entity', 'frontend router'"
user-invocable: true
disable-model-invocation: false
---

# Design Doc Sync

## Pipeline Position

```
grill-me-with-design → write-a-spec → spec-to-plan → tdd → 【design-doc-sync】
         ↑________________________________________________________________________________↓ (循环)
```

> 四条路径全景（权威图）见 `ProjectModel/README.md`「开发流水线」；上图仅示意本 Skill 的位置。

**上游**（四种来源）：
- 主流水线：`tdd` 全部切片完成后**自动衔接**进入（并将 Plan 与 Spec 置为 done）
- RFC 快车道：`tdd` 完成后**自动衔接**进入（并将该 RFC 置为 implemented）
- 中型路径（grill me simple）：`tdd`（无计划模式）完成后**自动衔接**进入
- 零散小改动：`read-design-before-code` 改码完成后**自动衔接**进入

**下游**：作为每条改码路径的**最后一步**，同步完成后引导用户三选一（均需显式触发）：改动大 / 摩擦明显 → `improve-codebase-architecture` 架构审视；新功能 → 新一轮 grill；有 accepted RFC → "rfc to plan" 快车道

> **定位**：功能开发（`tdd` 或零散改码）完成、代码定型后，本 Skill 作为收尾步骤统一更新设计文档，保证文档与最终代码一致，避免对未定稿的代码反复改文档。架构审视 `improve-codebase-architecture` 只产出 RFC、不改代码，因此不排在本 Skill 之前，而是本 Skill 出完报告后由用户按需显式触发 —— 它探索代码时读到的 Design 因此总是最新的。

## Goal

Keep implementation and design documents aligned after every feature development or code modification.

## Required Documents

1. ProjectModel/Design/backend.md
2. ProjectModel/Design/frontend.md
3. ProjectModel/Design/database/database-relations.md
4. ProjectModel/Design/database/data-er.md
5. ProjectModel/Design/database/sql.md

> **章节级守卫**：各 Design 文档的规范章节（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」）是项目级代码规范，**本 Skill 不得改动**。改码中产生的规范候选由 `tdd` / `read-design-before-code` 在各自收尾时列出并经用户显式判定后写入；本 Skill 只同步其余架构章节。若发现本轮代码与规范章节冲突，在 Report 1 中列出，不代为修改规范。

## When To Use

> **全局不变量：凡改码，必以本 Skill 收尾。** 四条路径均在改码完成后**自动衔接**进入本 Skill（见 Pipeline Position）。
>
> 唯一禁止的时机：**不要**在 `tdd` 的每个切片之间触发本 Skill —— 等本路径的改码全部完成、代码定型后，再一次性同步。

Use this skill whenever changes include any of the following:

1. Backend API, service, mapper, security, config, feign integration
2. Frontend router, view, component, store, request layer
3. Entity fields, SQL schema, table relationship changes
4. API contract updates between frontend and backend

## Update Matrix

1. Backend logic/API changed -> update ProjectModel/Design/backend.md
2. Frontend page/route/state/API usage changed -> update ProjectModel/Design/frontend.md
3. Entity/mapper/SQL/relationship changed -> update ProjectModel/Design/database/database-relations.md, ProjectModel/Design/database/data-er.md and ProjectModel/Design/database/sql.md
4. Cross-layer contract changed -> update both backend and frontend docs

## Procedure

1. Collect changed files (git diff or modified file list).
2. Classify each change by layer: backend / frontend / database.
3. Update all required design documents according to the update matrix.
4. Add concrete details, not vague summary:
   - changed module/path
   - new or modified API, field, relation, flow
   - compatibility or migration note if needed
5. Validate consistency between docs and code:
   - endpoint paths and method names are real
   - entity field names are real
   - relation cardinality matches current implementation
6. 产物生命周期收尾：
   - 若本轮实施的是 `Todo/Rfcs/` 中的某份 RFC（RFC 快车道），将其 frontmatter `status` 从 `accepted` 更新为 `implemented`，并把其 Implementation Recommendations 中已生效的架构指导并入对应的 Design 文档。
   - 将本轮对应的 `Todo/Plans/{feature-name}-plan.md` 及其 Parent `Todo/Specs/{feature-name}-spec.md`（如有）的 frontmatter `status` 置为 `done`。中型路径无 Plan/Spec，跳过此项。
7. Before finishing task, run the checklist below.

## Completion Checklist

- [ ] If backend changed, ProjectModel/Design/backend.md is updated.
- [ ] If frontend changed, ProjectModel/Design/frontend.md is updated.
- [ ] If entity/schema changed, ProjectModel/Design/database/database-relations.md is updated.
- [ ] If entity/schema changed, ProjectModel/Design/database/data-er.md is updated.
- [ ] If entity/schema changed, ProjectModel/Design/database/sql.md is updated.
- [ ] Cross-layer changes are reflected in all affected docs.
- [ ] No stale or contradictory statement remains.
- [ ] 未改动任何规范章节（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」）；代码与规范的冲突已在 Report 1 列出。
- [ ] If this round implemented an RFC, its frontmatter status is updated to `implemented`.
- [ ] 本轮对应的 Plan / Spec frontmatter `status` 已置为 `done`（如适用）。
- [ ] 三份报告均已输出：文档同步报告 / Delta & 人工动作清单 / Git 提交描述。

## Final Output Requirement

When finishing a development task, provide THREE reports:

### Report 1: Doc Sync Report

1. Which of the required docs were updated.
2. Which sections were changed.
3. If any doc was not updated, explain why.

### Report 2: Delta & 人工动作清单（凡执行 design-doc-sync 均须输出）

文档同步只保证"文档 = 代码"，但**环境 ≠ 代码**——建表、改字段、配置中心等代码管不到的事需要用户人工执行。**流水线内收尾与流水线外零散改动均须输出本报告**：零散小改动同样可能涉及字段、配置变更，且多数类为"无"时成本极低。本报告面向用户总结本轮的差异化与待办动作：

1. **功能差异**：本轮改了什么，按 backend / frontend / database 分层概述（对照本轮开始前的基线）
2. **数据库变更**：新增/修改的表、字段、索引、枚举值 —— **附上需要执行的 DDL**（建表 / ALTER 语句，从 `sql.md` 的变更部分导出，可直接复制执行）
3. **配置变更**：新增/修改的配置项（分布式配置中心、环境变量、密钥、开关），标注**在哪个环境、配置什么键、什么值**
4. **其他人工动作**：数据迁移/回填、定时任务注册、权限开通、第三方服务申请、依赖升级等
5. 每一项标注状态：**✅ 代码已完成（无需动作）** / **⏸️ 需人工执行（附具体操作步骤）**

**规则**：某一类若无变更，显式写"无"，不得省略该类 —— 省略会让用户无法区分"没有变更"和"漏查了"。

### Report 3: Git 提交描述（凡执行 design-doc-sync 均须输出）

本轮代码定型后，输出一条**可直接复制使用**的 Git 提交描述，遵循 Conventional Commits 约定。

**类型前缀**：

| 前缀 | 适用场景 |
|------|---------|
| `feat:` | 新增功能（主流水线大功能、中型改动新增能力） |
| `fix:` | Bug 修复 |
| `refactor:` | 重构，外部行为不变（**RFC 快车道通常用此**） |
| `perf:` | 性能优化 |
| `docs:` | 仅文档变更 |
| `test:` | 仅测试变更 |
| `style:` | 仅格式调整，不影响逻辑 |
| `chore:` | 构建 / 依赖 / 配置等杂项 |

**格式**：

```
<type>(<scope>): <一行简短描述，祈使句，不加句号>

<正文：本轮关键变更，分点列出，与 Report 2 的功能差异一致但更简洁>

<脚注：关联的 Spec / RFC / Plan 文件路径；破坏性变更以 BREAKING CHANGE: 开头说明>
```

**规则**：

1. `scope` 可选，取受影响的模块名（如 `feat(payment):`）
2. 一轮改动跨多个类型时，**以主要类型为准**（如既有新功能又有配套重构 → `feat:`）
3. **破坏性变更必须声明**：API 契约不兼容、字段删除、配置项重命名等，在脚注以 `BREAKING CHANGE:` 开头说明影响与迁移方式
4. 脚注注明本轮来源，便于溯源：`Refs: ProjectModel/Todo/Specs/{feature}-spec.md`（或 Rfcs / Grills 路径）
5. **只输出描述文本，不代替用户执行 `git commit`** —— 除非用户明确要求提交

## Next Step Guidance

设计文档同步完成后，作为流水线最后一步，向用户提示：

```
✅ 设计文档已同步更新！本轮开发循环完成。
   （已输出：文档同步报告 + Delta & 人工动作清单 + Git 提交描述）

📋 下一步（三选一，均由你显式触发）：
   - 本轮改动大 / 架构摩擦明显 → 建议先 /compact 或 /clear，再 /improve-codebase-architecture 做架构审视
     （只产出 RFC、不改代码；它读的是代码、Design 与旧 RFC，全在磁盘上）。
   - 有新的功能需求 → /grill-me-with-design 开启新一轮开发循环。
   - Todo/Rfcs/ 中存在 status: accepted 的待实施 RFC → 输入 "rfc to plan" 走「RFC 快车道」
     （以最新的 accepted RFC 为输入；Design 刚同步完，前提已满足）。
     也可以先沉淀不实施 —— 下一轮 improve 会基于当时的代码重新审视旧摩擦。
```
