---
name: spec-to-plan
description: "Break a Spec (or an accepted architecture RFC) into an executable implementation plan organized as tracer-bullet vertical slices; save it to Todo/Plans/. Use when the user wants to convert a Spec or RFC to a plan, create an implementation plan, break down a Spec into work items, or mentions 'spec-to-plan'."
argument-hint: "Spec filename under Todo/Specs/, e.g. 'payment-module', 'user-auth'"
user-invocable: true
disable-model-invocation: false
---

# Spec to Plan

将 Spec（或已接受的架构 RFC）拆解为可执行的实施计划，保存到 `Todo/Plans/` 目录。采用垂直切片（Tracer Bullet）方式组织。

## Pipeline Position

```
grill-me-with-design → write-a-spec → 【spec-to-plan】 → tdd → design-doc-sync
                                                      ↑_____________________________↓ (循环)
```

> 四条路径全景（权威图）见 `ProjectModel/README.md`「开发流水线」；上图仅示意本 Skill 的位置。

**上游**：接收 `write-a-spec` 生成的 Spec 文档（位于 `Todo/Specs/` 目录）；或走 **RFC 快车道**时，接收 `improve-codebase-architecture` 产出的 `status: accepted` RFC（位于 `Todo/Rfcs/` 目录，见下文 RFC 模式）
**下游**：产出实施计划文档，供 `tdd` 阶段按计划逐条执行

## When To Use

1. Spec 已完成并通过拷问验证
2. 用户想把 Spec 转化为可执行的开发计划
3. 用户提到 "spec-to-plan"、"rfc to plan"、"转计划"、"拆任务"
4. **RFC 快车道**（显式输入 "rfc to plan"；通常紧接 `improve-codebase-architecture` 之后，也可对沉淀的 RFC 随时发起）：用户想实施 `Todo/Rfcs/` 中 `status: accepted` 的架构 RFC（RFC 已经过多方案对比与用户选定，无需重走 grill / write-spec；实施完成后直接以 design-doc-sync 收尾，**不再经过 improve-codebase-architecture** —— RFC 本身就是它的产物）

## Process

### 1. Locate the input (Spec or RFC)

**Spec 模式（默认）**：从 `Todo/Specs/` 目录中定位 Spec 文件。文件命名格式为 `{feature-name}-spec.md`。

如果用户提供了 Spec 文件名，直接读取。如果未提供，列出 `Todo/Specs/` 目录下的所有文件供用户选择。

读取 Spec 全文内容，确保完整理解所有 User Stories 和 Implementation Decisions。

**RFC 模式（快车道）**：用户指定实施某个架构 RFC 时，从 `Todo/Rfcs/` 目录读取 `{module-name}-rfc.md`。前置条件：

- RFC 的 frontmatter `status` 为 `accepted`（仍为 `proposed` 的 RFC 未经用户选定接口，不能直接拆计划）
- 设计文档已与当前代码同步（后续 tdd 的 Pre-read Design 才能读到正确基线）：主流水线中 sync 在 tdd 后自动执行、improve 又不改代码，所以紧接 improve 进入时天然满足；若 RFC 沉淀多轮后才实施、或在未 sync 的改码之后触发，先跑一次 `design-doc-sync`。新会话中无法确认时直接询问用户，不要臆断
- 若多份未实施 RFC 覆盖同一模块，以**最新的 `accepted`** 为输入（更早的应已被 `improve` 置为 `superseded`；若发现仍为 `accepted` 的重叠旧 RFC，提示用户确认取舍，不要默认实施旧提案）

读取 RFC 全文，重点理解 Proposed Interface（目标接口契约）、Testing Strategy（需新增的边界测试与需删除的旧测试）和 Implementation Recommendations（调用方迁移路径）。

### 2. Explore the codebase (optional)

如果尚未探索过代码库，先探索以了解当前代码状态。这有助于判断哪些模块需要新建、哪些需要修改。

### 3. Draft vertical slices

将 Spec 拆解为 **tracer bullet** 计划项。每个计划项是一个贯穿所有集成层的薄垂直切片，而非某一层的水平切片。

每个切片标记为 'HITL' 或 'AFK'：
- **HITL** (Human-In-The-Loop)：需要人工交互，如架构决策、设计评审
- **AFK** (Away From Keyboard)：可自动实现并合并，无需人工干预

<vertical-slice-rules>
- 每个切片交付一条窄但 COMPLETE 的路径（schema → API → UI → tests）
- 完成的切片可独立演示或验证
- 宁多勿少：优先拆成多个薄切片，而非少数厚切片
</vertical-slice-rules>

**RFC 模式的切片规则（绞杀式迁移）**：重构没有新增的用户可见行为，切片不按 schema → API → UI 组织，而按迁移路径组织：

1. 第一片：建立 RFC 定义的新接口（旧代码不动），在新接口边界编写测试
2. 中间片：按调用方分组，逐组迁移到新接口，每片结束时全部测试保持绿色
3. 最后一片：删除旧实现 + 删除已被边界测试取代的浅模块旧测试（替换，而非堆叠）

每片的验收标准统一为：**可观察行为不变 + 新接口边界测试通过**。

### 4. Quiz the user

以编号列表展示拆解方案。每个切片包含：

- **Title**: 简短描述性名称
- **Type**: HITL / AFK
- **Blocked by**: 依赖哪些其他切片（如有）
- **User stories covered**: 覆盖 Spec 中的哪些 User Story
- **Estimated complexity**: S / M / L

向用户确认：

- 粒度是否合适？（太粗 / 太细）
- 依赖关系是否正确？
- 是否需要合并或进一步拆分？
- HITL / AFK 标记是否正确？

反复迭代直到用户批准拆解方案。

### 5. Write the Plan document

将批准后的计划保存到 `Todo/Plans/` 目录，文件命名为 `{feature-name}-plan.md`。

使用以下模板：

<plan-template>
---
status: active   # active（进行中）/ done（收尾 design-doc-sync 时置为 done）
---

# {Feature Name} — Implementation Plan

## Parent Spec / RFC

- File: `Todo/Specs/{feature-name}-spec.md`（或 `Todo/Rfcs/{module-name}-rfc.md`）

## Plan Overview

简要描述整体实施策略和切片间的依赖关系。

## Slices

### Slice 1: {Title}

- **Type**: HITL / AFK
- **Blocked by**: None / Slice X
- **User stories**: #X, #Y（RFC 模式：覆盖的接口契约 / 迁移的调用方分组）
- **Complexity**: S / M / L

**What to build**:
端到端的行为描述，而非逐层实现细节。引用 Spec 中的具体章节。

**Acceptance criteria**:
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

**Implementation hints**:
- 涉及的模块/文件范围（不绑定具体路径）
- 需要新建的接口或数据表
- 需要注意的兼容性问题

---

### Slice 2: {Title}
...

## Dependency Graph

```
Slice 1 → Slice 3 → Slice 5
         ↘ Slice 4 ↗
Slice 2 → Slice 4
```

## Risk Notes

- 列出实施过程中可能遇到的风险和缓解策略

## Status Tracking

| Slice | Status | Assignee | Notes |
|-------|--------|----------|-------|
| 1 | 🔴 Not started | - | - |
| 2 | 🔴 Not started | - | - |

Status: 🔴 Not started | 🟡 In progress | 🟢 Done | ⚠️ Blocked
</plan-template>

### 6. Next Step Guidance

计划文档写入完成后，向用户提示（此处是人工卡点，**不要**自动进入 tdd）。提示中必须包含**压缩上下文**这一步：grill / write-a-spec / spec-to-plan 三个阶段已占用大量上下文，而 tdd 的全部输入（Plan、Spec、Design）都已落盘，此处是整条流水线最安全、收益最大的压缩点 —— 主动压缩可把自动压缩推远，避免它落在某个切片的 RED 与 GREEN 之间。Skill 自身无法执行压缩，须由用户键入 `/compact` 或 `/clear`：

```
✅ 实施计划已保存到 Todo/Plans/{feature-name}-plan.md

⏸️ 请人工 review 切片拆解（重点：粒度、依赖关系、HITL/AFK 标记）。

🧹 确认无误后，先压缩上下文再进入实施（tdd 的输入已全部落盘，前面的访谈对话不再需要）：
   /compact 保留 feature 名 {feature-name}、Todo/Plans/{feature-name}-plan.md 与 Todo/Specs/{feature-name}-spec.md 的路径，其余对话内容可丢弃
   或直接 /clear 开新会话（更干净）。tdd 会重新读取 Plan、Spec 与 Design，不依赖对话记忆。

📋 然后选择一种模式进入实施：
   - tdd       — 单切片模式：每完成一个切片暂停，由你决定是否继续
   - tdd auto  — 连续模式：按依赖顺序连续执行 AFK 切片，仅在 HITL 切片或阻塞时暂停
   建议从第一个无依赖的切片开始，采用 Red-Green-Refactor 循环逐步完成。
```

## Anti-Patterns

- ❌ 水平切片（先做所有 schema，再所有 API，再所有 UI）→ ✅ 垂直切片（每个切片端到端）
- ❌ 计划项过于粗略 → ✅ 每个切片应能在一次开发会话中完成
- ❌ 忽略依赖关系 → ✅ 明确标注阻塞关系，按依赖顺序执行
- ❌ 直接开始编码 → ✅ 先产出计划文档，获得用户确认后再进入 tdd

## Completion Checklist

- [ ] 输入文件已完整读取（Spec 来自 `Todo/Specs/`；RFC 来自 `Todo/Rfcs/` 且 `status: accepted`）
- [ ] 所有 User Stories 都被至少一个切片覆盖（RFC 模式：接口契约、全部调用方迁移、旧代码与旧测试清理均被切片覆盖）
- [ ] 每个切片都是端到端的垂直切片
- [ ] HITL / AFK 标记合理
- [ ] 依赖关系已明确标注
- [ ] 计划文件已写入 `Todo/Plans/{feature-name}-plan.md`
- [ ] 已向用户提示下一步操作：先压缩上下文（`/compact` 或 `/clear`），再进入 `/tdd`
