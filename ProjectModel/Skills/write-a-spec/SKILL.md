---
name: write-a-spec
description: "Write a Spec via user interview, codebase exploration, and module design; save it to Todo/Specs/. Use when the user wants to write a Spec, create a specification document, draft a Spec, or plan a new feature."
argument-hint: "Feature name to plan, e.g. 'payment-module', 'user-auth'"
user-invocable: true
disable-model-invocation: false
---

This skill will be invoked when the user wants to create a Spec. 访谈与探索类步骤（Procedure 第 1–4 步）可按需精简或跳过，例如由 grill 自动衔接进入时第 1 步整体跳过；**第 5 步按模板写 Spec、第 6 步保存与 frontmatter、第 7 步 Review 摘要不可跳过** —— 它们分别是下游 spec-to-plan 的输入、产物生命周期的依据、人工卡点的判定材料。

## Pipeline Position

```
grill-me-with-design → 【write-a-spec】 → spec-to-plan → tdd → design-doc-sync
                         ↑______________________↓ (迭代)
```

> 四条路径全景（权威图）见 `ProjectModel/README.md`「开发流水线」；上图仅示意本 Skill 的位置。

**上游**：由 `grill-me-with-design` 完成后**自动衔接**进入（读取 `Todo/Grills/` 报告作为输入）；也可独立显式触发
**下游**：Spec 产物需**人工 review** —— 保存后在终端输出 **Review 摘要**（含相对 Grill 报告的新增决策与建议 review 深度，见第 7 步），简单改动看摘要即可放行，不必通读全文；用户确认无误后显式触发 `/spec-to-plan`（此衔接**不自动执行**）

## Pre-read Design Documents

在撰写 Spec 之前，先读取以下设计文档以了解当前架构：

1. `ProjectModel/Design/backend.md`
2. `ProjectModel/Design/frontend.md`
3. `ProjectModel/Design/database/database-relations.md`
4. `ProjectModel/Design/database/data-er.md`
5. `ProjectModel/Design/database/sql.md`

判定标准与 grill 一致：文档**不存在、为空、或某章节仅含占位词**（`示例：` / `暂无` / `待补充` / `待确认` / `<TODO>`，定义见 `ProjectModel/README.md`「占位词约定」）即视为该部分**尚未决策**，不得当作既定约束写进 Implementation Decisions。由 grill 衔接进入时，这些未决点通常已在拷问中裁决并记录在 Grill 报告，以报告为准；仍未裁决的，在 Spec 的 Further Notes 标注"需先补充设计文档：{文档 / 章节}"，并在 Review 摘要的"开放问题"中列出。

## Pre-read Grill Report

若存在 `Todo/Grills/{feature-name}-grill.md`（`grill-me-with-design` 的总结报告），必须先读取：其中已确认的决策直接作为 Spec 的输入，访谈时不再重复追问已定事项；发现的冲突与风险清单作为 Implementation Decisions 与 Further Notes 的素材。

## Procedure

1. Ask the user for a long, detailed description of the problem they want to solve and any potential ideas for solutions.

   **自动衔接例外**：若由 grill-me-with-design 自动衔接进入（存在对应的 `Todo/Grills/{feature-name}-grill.md`），**跳过本步的全量描述**，并将第 3 步的访谈收窄为：以 Grill 报告已确认的决策为既定输入，仅就报告未覆盖的缺口提问，不重复已定事项。

2. Explore the repo to verify their assertions and understand the current state of the codebase.

3. Interview the user relentlessly about every aspect of this plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

4. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

5. Once you have a complete understanding of the problem and solution, use the template below to write the Spec.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this Spec.

## Further Notes

Any further notes about the feature.

</spec-template>

### 6. Save the Spec

将 Spec 保存到 `Todo/Specs/` 目录，文件命名为 `{feature-name}-spec.md`（`{feature-name}` 沿用 Grill 报告确认的名称）。

文件头部加 frontmatter 跟踪生命周期：

```markdown
---
status: active   # active（进行中）/ done（收尾 design-doc-sync 时置为 done）
---
```

### 7. Review 摘要与下一步提示

Spec 保存完成后，**先在终端输出 Review 摘要，再给下一步提示**（此处是人工卡点，**不要**自动进入 spec-to-plan）。摘要的目的是让用户不必通读全文就能判定是否放行：简单改动看摘要即可，复杂改动由摘要指出该细读哪一节。

**摘要规则**：

1. 摘要是 Spec 全文的**投影**：每一条都必须能在 Spec 中找到对应内容，不得引入 Spec 里没有的信息；摘要不落盘（Spec 本身是产物，摘要可随时重生成）。
2. **相对 Grill 报告的新增决策是 review 重点**：Grill 中的决策已由用户逐个确认，无需再看；本次访谈新增、未经拷问的决策才真正需要用户把关。逐条列出；无 Grill 报告时注明"全部决策均为本次访谈确认"。
3. 每一类若为空，显式写"无"，不得省略 —— 省略会让用户无法区分"没有"和"漏了"。
4. 控制在终端一屏内（约 20 行）；User Stories 只给数量与核心条目标题，不全列。
5. 给出**建议 review 深度**，判定依据固定为三条：相对 Grill 的新增决策数、是否涉及 Schema 或 API 契约变更、是否有开放问题。
   - **看摘要即可**：三者皆无
   - **建议阅读 Implementation Decisions 一节**：有新增决策，或有 Schema / API 契约变更
   - **建议通读全文**：有开放问题，或有破坏性变更（不兼容的 API / 字段删除 / 数据迁移）
6. 用户看完摘要要求修改时，更新 Spec 后**重新输出摘要**，直到用户放行。

**输出模板**：

```
✅ Spec 已保存到 Todo/Specs/{feature-name}-spec.md（status: active）

📄 Review 摘要
- 问题：{一句话}
- 方案：{一句话}
- 影响面：backend {模块} / frontend {页面 / 组件} / database {表}（无则写"无"）
- 关键实现决策（{N} 项）：
  · API：{新增 / 修改的端点，方法 + 路径}
  · Schema：{新增 / 修改的表与字段}
  · 架构：{新建 / 修改的模块，提取的深模块}
- 相对 Grill 报告的新增决策（{M} 项，未经拷问确认，review 重点）：
  · {决策 1}
  · …（无则写"无"）
- 兼容性：{是否破坏现有 API / 是否需要数据迁移；无则写"无"}
- User Stories：{N} 条，核心 {K} 条 —— {核心条目标题}
- Out of Scope：{要点}
- 测试决策：{将测试的模块}
- 开放问题：{逐条；无则写"无"}

🔎 建议 review 深度：{看摘要即可 / 建议阅读 Implementation Decisions 一节 / 建议通读全文}
   依据：新增决策 {M} 项；Schema / API 契约变更 {有 / 无}；开放问题 {有 / 无}

⏸️ 确认无误后，显式使用 /spec-to-plan 将 Spec 转化为可执行的实施计划
   计划将保存到 Todo/Plans/{feature-name}-plan.md。需要修改时直接说明，我会更新 Spec 并重新输出摘要。
```