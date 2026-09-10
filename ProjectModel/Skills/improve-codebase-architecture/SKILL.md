---
name: improve-codebase-architecture
description: "Explore the codebase to surface architectural friction and propose deepening of shallow modules to improve testability. Use when the user wants to improve architecture, review architecture, deepen modules, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more AI-navigable."
argument-hint: "Optional: module or directory scope to review"
user-invocable: true
disable-model-invocation: false
---

# Improve Codebase Architecture

Explore a codebase like an AI would, surface architectural friction, discover opportunities for improving testability, and propose module-deepening refactors.

A **deep module** (John Ousterhout, "A Philosophy of Software Design") has a small interface hiding a large implementation. Deep modules are more testable, more AI-navigable, and let you test at the boundary instead of inside.

## Pipeline Position

```
[任一改码路径] → design-doc-sync（三份报告）→〔/compact〕→ 【improve-codebase-architecture】（显式触发）
                                                                    │
                                                                    └→ RFC(accepted) → 显式 "rfc to plan" → RFC 快车道（spec-to-plan → tdd →(自动) design-doc-sync）
```

> 四条路径全景（权威图）见 `ProjectModel/README.md`「开发流水线」；上图仅示意本 Skill 的位置。

本 Skill **不在任何流水线内**，是与 `to-design` 同级的**旁路工具**：**只产出 RFC、不改代码**，仅由用户**显式触发**（"improve architecture" 等关键词或 `/improve-codebase-architecture`）。

**上游**：任意时刻的当前代码库。典型时机是 `design-doc-sync` 出完三份报告、上下文压缩之后，本轮改动大 / 摩擦明显时；也可在任何时候对代码库单独发起。前提：Design 已与代码同步 —— 紧接 sync 时天然满足；若在未 sync 的改码之后触发，先跑一次 `design-doc-sync`，否则探索时读到的 Design 是过期的。
**下游**：RFC 保存后引导用户显式输入 **"rfc to plan"** 走 RFC 快车道实施；也可先沉淀不实施。本 Skill 不改代码，结束后**无需再跑 design-doc-sync**。

## Dependency Categories

评估模块加深时，将依赖分为以下四类：

| 类别 | 说明 | 策略 |
|------|------|------|
| **In-process** | 纯计算、内存状态、无 I/O | 直接合并模块，直接测试 |
| **Local-substitutable** | 有本地测试替身（如 PGLite 替代 Postgres） | 用本地替身在测试套件中测试 |
| **Remote but owned** | 跨网络边界的自有服务（微服务、内部 API） | 端口与适配器模式：定义 Port 接口，生产用 HTTP/gRPC 适配器，测试用内存适配器 |
| **True external** | 第三方服务（Stripe、Twilio 等） | 在边界 Mock，以注入端口形式提供，测试用 Mock 实现 |

## Testing Strategy

核心原则：**替换，而非堆叠。**

- 浅模块上的旧单元测试在边界测试存在后即为浪费 — 删除它们
- 在加深后的模块接口边界编写新测试
- 测试通过公共接口断言可观察的结果，而非内部状态
- 测试应能经受内部重构 — 它们描述行为，而非实现

## Process

### 0. Pre-read: Design 架构章节 + 未实施的 RFC

1. **读五份 Design 文档的架构章节**：`backend.md` 的目录结构与分层、模块边界、API 端点、核心业务流程；`frontend.md` 的目录结构、状态管理、API 调用层；`database/` 三份的表关系。它们记录的是**已声明的边界**，探索代码时把"声明的边界"与"实际的耦合"对照 —— 二者的落差本身就是摩擦信号；后续每个候选的 Cluster 描述须引用对应的 Design 章节。规范章节只读不评，写法问题不属于本 Skill。前提是 Design 已与代码同步（见 Pipeline Position）：若发现文档明显落后于代码，先停下建议用户跑 `design-doc-sync`，不要在过期文档上做架构判断。
2. 读取 `Todo/Rfcs/` 中未实施的 RFC（`status: proposed` / `accepted`）。RFC 允许沉淀多轮不实施：旧 RFC 指出的摩擦若在本轮探索中仍然存在，必须被本轮的新 RFC 重新包含 —— **以当前代码为准重新审视，而非照搬旧结论**（旧 RFC 产出后代码可能已经演化）。

### 1. Explore the codebase

Navigate the codebase naturally. If the environment provides sub-agents (e.g. an Explore-type agent), delegate the navigation to one; otherwise explore directly yourself — the deliverable is the same. Do NOT follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small files?
- Where are modules so shallow that the interface is nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called?
- Where do tightly-coupled modules create integration risk in the seams between them?
- Which parts of the codebase are untested, or hard to test?

The friction you encounter IS the signal.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate, show:

- **Cluster**: Which modules/concepts are involved（引用 Design 架构章节中对应的模块边界 / 分层条目，并指出代码实际耦合与之的落差）
- **Why they're coupled**: Shared types, call patterns, co-ownership of a concept
- **Dependency category**: See Dependency Categories table above
- **Test impact**: What existing tests would be replaced by boundary tests

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. User picks a candidate

### 4. Frame the problem space

Before designing interfaces (or spawning sub-agents, if available), write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would need to rely on
- A rough illustrative code sketch to make the constraints concrete — this is not a proposal, just a way to ground the constraints

Show this to the user, then immediately proceed to Step 5. The user reads and thinks about the problem while the designs are produced.

### 5. Design multiple interfaces

Produce 3+ **radically different** interface designs for the deepened module. If the environment supports parallel sub-agents, spawn one per design constraint; otherwise work through the same constraints sequentially yourself — the deliverable (3+ contrasting designs) is identical either way.

Each design starts from a separate technical brief (file paths, coupling details, dependency category, what's being hidden). This brief is independent of the user-facing explanation in Step 4. Give each design a different constraint:

- Design 1: "Minimize the interface — aim for 1-3 entry points max"
- Design 2: "Maximize flexibility — support many use cases and extension"
- Design 3: "Optimize for the most common caller — make the default case trivial"
- Design 4 (if applicable): "Design around the ports & adapters pattern for cross-boundary dependencies"

Each design deliverable includes:

1. Interface signature (types, methods, params)
2. Usage example showing how callers use it
3. What complexity it hides internally
4. Dependency strategy (how deps are handled — see Dependency Categories table)
5. Trade-offs

Present designs sequentially, then compare them in prose.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated — the user wants a strong read, not just a menu.

### 6. User picks an interface (or accepts recommendation)

### 7. Save the architecture RFC

将架构改进 RFC 保存到 `Todo/Rfcs/` 目录，文件命名为 `{module-name}-rfc.md`。

**RFC 生命周期**（frontmatter `status` 字段，权威定义见 `ProjectModel/README.md`「RFC 生命周期」）：

- `accepted` — 用户已在 Step 6 选定接口，保存时默认此状态，等待实施
- `proposed` — 用户尚未选定接口、仅先沉淀方案时使用
- `implemented` — RFC 实施完成后，由收尾的 `design-doc-sync` 更新
- `superseded` — 被后续 RFC 取代；取代者应在正文注明取代了哪份

保存新 RFC 时，检查 `Todo/Rfcs/` 中未实施（`proposed` / `accepted`）的旧 RFC：与新 RFC 范围重叠的置为 `superseded`。快车道始终以**最新的 `accepted`** RFC 为输入。

使用以下模板：

```markdown
---
status: accepted
---

# {Module Name} — Architecture RFC

## Problem

描述架构摩擦：

- 哪些模块是浅模块且紧密耦合
- 模块之间存在什么集成风险
- 为什么这使得代码库更难导航和维护

## Proposed Interface

选定的接口设计：

- 接口签名（类型、方法、参数）
- 调用方使用示例
- 内部隐藏了什么复杂性

## Dependency Strategy

适用的类别及依赖处理方式：

- **In-process**: 直接合并
- **Local-substitutable**: 用 [具体替身] 测试
- **Ports & adapters**: 端口定义、生产适配器、测试适配器
- **Mock**: 外部服务的 Mock 边界

## Testing Strategy

- **需编写的边界测试**: 在接口处验证的行为
- **需删除的旧测试**: 变得冗余的浅模块测试
- **测试环境需求**: 所需的本地替身或适配器

## Implementation Recommendations

不绑定具体文件路径的持久架构指导：

- 模块应拥有什么（职责）
- 应隐藏什么（实现细节）
- 应暴露什么（接口契约）
- 调用方应如何迁移到新接口
```

### 8. Next Step Guidance

架构审视和改进建议完成后，向用户提示：

```
✅ 架构审视完成！改进 RFC 已保存到 Todo/Rfcs/{module-name}-rfc.md（status: accepted）

📋 下一步（由你显式触发；本工具不改代码，无需再跑 design-doc-sync）：

   📌 要实施本 RFC → 输入 "rfc to plan" 走「RFC 快车道」：spec-to-plan 以该 RFC 为输入拆解迁移切片
      （RFC 已经过多方案对比与用户选定，无需重走 grill / write-spec），随后 /tdd 实施，
      完成后自动衔接 /design-doc-sync 收尾并将 RFC 状态置为 implemented。
      快车道不再经过 improve-codebase-architecture —— 只实施本 RFC，不产出新 RFC。

   📌 也可以先沉淀不实施：下一轮 improve 会基于当时的代码重新审视，
      旧摩擦若仍存在会被新 RFC 包含（重叠的旧 RFC 届时置为 superseded）。
      沉淀多轮后再实施时，先确认最近一次改码已 sync，再 "rfc to plan"。
```

## Completion Checklist

- [ ] 代码库已自然导航探索（子代理或本体均可）
- [ ] 已如实列出全部真实的加深候选（可少于 3 个；不足时说明原因，不凑数）
- [ ] 每个候选标注了依赖类别和测试影响
- [ ] 为选定候选设计了 3+ 个不同接口方案
- [ ] 给出了明确的推荐方案（含理由）
- [ ] 用户已选定最终接口设计
- [ ] 已读五份 Design 文档的架构章节，每个候选的 Cluster 引用了对应的模块边界 / 分层条目
- [ ] 已读取 `Todo/Rfcs/` 中未实施的旧 RFC，其仍存在的摩擦已被本轮重新审视
- [ ] 架构 RFC 已保存到 `Todo/Rfcs/{module-name}-rfc.md`（frontmatter `status: accepted`）
- [ ] 与新 RFC 范围重叠的未实施旧 RFC 已置为 `superseded`
- [ ] 已向用户提示下一步操作（显式 "rfc to plan" 走快车道，或先沉淀；无需再跑 design-doc-sync）
