---
name: grill-me-with-design
description: "Relentlessly stress-test a user's plan or design against existing design docs. Reads all docs under ProjectModel/Design/ first, then interrogates each decision for consistency with the established architecture, API contracts, database schema, and module boundaries. Two modes with identical grilling depth: standard ('grill me') auto-chains into write-a-spec for large features; simple ('grill me simple') is a pipeline-routing directive for medium-sized changes that auto-chains directly into tdd (planless mode), skipping Spec and plan — it does NOT relax the interrogation. Use when the user wants to stress-test a plan, get grilled on their design, validate a design against existing architecture, or mentions 'grill me' / 'grill me simple'."
argument-hint: "Short description of the plan or design to grill, e.g. 'new payment module', 'refactor user auth flow'"
user-invocable: true
disable-model-invocation: false
---

# Grill Me With Design

## Goal

结合项目现有设计文档，对用户的计划或设计进行无情的、系统性的拷问，确保每个决策分支都与已有架构一致、不引入矛盾、不遗漏依赖。

## Pipeline Position

```
【grill-me-with-design】 → write-a-spec → spec-to-plan → tdd → design-doc-sync
         ↑________________________________________________________________________↓ (循环)
```

> 四条路径全景（权威图）见 `ProjectModel/README.md`「开发流水线」；上图仅示意本 Skill 的位置。

**上游**：接收用户的初始设计想法
**下游**（按模式分岔，均为**自动衔接**，无需用户再次触发 —— 拷问中所有决策已经用户逐个确认）：
- **标准模式**（"grill me"）→ 自动进入 `write-a-spec`，人工把关点后移到 Spec 产物的 review 上
- **simple 模式**（"grill me simple"，中型改动路径）→ 自动进入 `tdd`（无计划模式），跳过 Spec 与切片计划

## Modes（标准 / simple）

| 模式 | 触发 | 适用 | 下游 |
|------|------|------|------|
| 标准 | "grill me" | 大功能：需要 Spec 与切片计划的完整流水线 | 自动衔接 write-a-spec |
| simple | "grill me simple" | 中型改动：跨 1-2 个模块、涉及 API 契约 / 表字段等高于零散改码的风险，但无需 Spec 级需求梳理。**拷问深度与标准模式完全一致** | 自动衔接 tdd（无计划模式） |

**重要：simple 只是路径选择指令，不是拷问放松**。两种模式的拷问深度**完全一致**：同样 Pre-read 全部 Required Design Documents、同样覆盖六个维度、同样一次一问追问到可执行为止。simple 改变的**只有下游衔接**——跳过 Spec 与切片计划，直接进入 tdd（无计划模式）。

- 总结报告同样落盘 `Todo/Grills/{feature}-grill.md` —— 它是下游 tdd 无计划模式的**唯一输入**，没有 Spec 兜底，拷问越扎实，无计划实施才越可靠
- 拿不准该走标准还是 simple 时，向用户确认一次（提示：需要独立的需求文档和多切片计划吗？）

## Required Design Documents (Pre-read)

在开始拷问之前，**必须**先读取以下设计文档：

1. `ProjectModel/Design/backend.md` — 后端架构、API 设计、服务边界
2. `ProjectModel/Design/frontend.md` — 前端架构、路由、组件、状态管理
3. `ProjectModel/Design/database/database-relations.md` — 数据库关系
4. `ProjectModel/Design/database/data-er.md` — 数据库 ER 图
5. `ProjectModel/Design/database/sql.md` — SQL Schema 定义

> 如果某个设计文档**不存在、为空、或仅含占位词**（`示例：` / `暂无` / `待补充` / `待确认` / `<TODO>`，定义见 `ProjectModel/README.md`「占位词约定」），视为该部分**尚未决策**，在拷问中针对这些未决点追问，而非将占位内容当作既定约束。

## When To Use

在以下场景触发此 Skill：

1. 用户想要验证一个新计划或设计是否合理
2. 用户想要对设计方案做压力测试
3. 用户想要检查新设计是否与现有架构冲突
4. 用户提到 "grill me"、"拷问我"、"审视我的设计"
5. 用户准备开始一个新功能的实现前

## Grilling Dimensions

拷问必须覆盖以下维度，每个维度至少提出一个问题：

### 1. 一致性 (Consistency)

- 新设计中的 API 路径、命名、请求/响应格式是否与 `ProjectModel/Design/backend.md` 中已定义的规范一致？
- 新设计中的前端路由、组件命名、状态管理方式是否与 `ProjectModel/Design/frontend.md` 中已定义的规范一致？
- 新设计中的数据表、字段命名、关系是否与 `ProjectModel/Design/database/` 中已定义的模式一致？
- 新设计中的命名、响应结构、分层等写法是否符合各文档的规范章节（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」）？规范章节中仍为占位的条目属于未决点，按 Phase 3 归并后优先追问

### 2. 边界 (Boundaries)

- 新设计是否越过了已有模块的职责边界？
- 是否将本属于 A 模块的逻辑放到了 B 模块？
- 是否引入了新的跨层依赖或循环依赖？

### 3. 数据流 (Data Flow)

- 新数据的完整生命周期是什么？从哪进入系统，经过哪些处理，最终存储到哪里？
- 是否有数据孤岛？是否有未被任何接口消费的数据？
- 数据变更是否会影响到已有的查询、报表或下游消费者？

### 4. 兼容性 (Compatibility)

- 新设计是否会破坏已有的 API 契约？
- 数据库变更是否需要迁移脚本？对已有数据的影响是什么？
- 前端变更是否需要同步更新多个页面或组件？

### 5. 完整性 (Completeness)

- 是否考虑了错误处理、边界情况、并发场景？
- 是否考虑了权限控制、数据校验、日志记录？
- 是否考虑了性能影响（索引、缓存、分页）？
- 是否遗漏了与其他模块的交互？

### 6. 必要性 (Necessity)

- 这个设计是否真的需要？有没有更简单的替代方案？
- 是否存在过度设计？能否用更少的代码/模块解决同样的问题？
- 新引入的依赖是否必要？能否复用已有的基础设施？

## Procedure

### Phase 1: Pre-read Design Documents

1. 读取所有 Required Design Documents。
2. 提取关键架构约束：
   - 后端：模块边界、API 规范、服务分层
   - 前端：路由结构、组件层级、状态管理模式
   - 数据库：表关系、字段约束、索引策略
3. 如果设计文档为空、缺失、或仅含占位词，将这些**未决点作为最优先的拷问对象**。

### Phase 2: Analyze User's Plan

1. 理解用户提出的计划或设计。
2. 将计划与已有设计文档进行交叉比对。
3. 列出所有潜在冲突点、遗漏点和风险点。

### Phase 3: Relentless Grilling

**核心规则：一次只问一个问题。每个问题给出 AI 的推荐答案。**

**未决点优先（含占位词的设计部分）**：若设计文档中存在未决点，先将散落的占位项**归并为若干关键决策**（如"后端技术栈未定""核心表结构未定""认证方案未定"），再按下面的顺序逐个深入拷问；**不要**逐个琐碎字段地追问，避免被细节淹没。只有已填的真实内容才作为既定约束参与一致性比对。

拷问顺序：

1. **先问最致命的问题** — 如果这个决策错了，后续所有工作都白费（未决的关键决策通常就属于此类，优先处理）
2. **再问一致性问题** — 确保不与已有设计冲突
3. **然后问边界问题** — 确保模块职责清晰
4. **接着问数据流问题** — 确保数据路径完整
5. **再问兼容性问题** — 确保不破坏已有功能
6. **最后问完整性和必要性问题** — 确保没有遗漏或过度设计

对于每个问题：

```
## 问题 N: [维度] 简短标题

**背景**：结合设计文档中的具体内容说明为什么这个问题重要
  - 引用 ProjectModel/Design/backend.md 第 X 节：...
  - 或引用 ProjectModel/Design/database/database-relations.md：...

**问题**：具体的拷问内容

**我的推荐**：AI 基于已有架构给出的推荐答案

**请回答**：等待用户回应后，根据回答继续追问或进入下一个问题
```

### Phase 4: Summary Report

拷问结束后，输出一份总结报告：

1. **确认的决策**：用户做出的所有关键决策列表
2. **发现的冲突**：新设计与已有设计的冲突点及解决方案
3. **需要更新的文档**：哪些设计文档需要因此次设计而更新
4. **风险清单**：仍存在的风险或未解决的问题
5. **下一步建议**：建议的执行顺序

保存前，先与用户确认本次 feature 的**正式名称**（kebab-case，如 `payment-module`）：它是整条产物链的文件名前缀（`{feature-name}-grill.md` → `-spec.md` → `-plan.md`），一经确认全链沿用。

报告输出到会话的同时，**必须保存一份到 `Todo/Grills/{feature-name}-grill.md`**（同名已存在 = 同一 feature 重新拷问，直接覆盖，最新为准）。会话上下文可能被压缩或丢失，落盘的报告才是下游（write-a-spec 或 tdd 无计划模式）的正式输入。

报告模板：

```markdown
---
feature: {feature-name}
mode: standard | simple
date: YYYY-MM-DD
---

# {Feature Name} — Grill Report

## 1. 确认的决策
## 2. 发现的冲突
## 3. 需要更新的文档
## 4. 风险清单
## 5. 下一步建议
```

> simple 模式下，后续 tdd（无计划模式）确认行为清单后会在报告末尾追加「## 已确认行为清单」一节并逐项跟踪状态。

## Grilling Tone

- **直接**：不绕弯子，直击要害
- **具体**：引用设计文档中的具体内容，不泛泛而谈
- **持续**：不满足于模糊的回答，追问到足够具体为止
- **建设性**：每个问题都附带推荐答案，不只是挑毛病
- **有记忆**：记住用户之前的回答，后续问题中引用

## Anti-Patterns

- ❌ 一次性抛出所有问题 → ✅ 逐个追问
- ❌ 脱离设计文档空问 → ✅ 基于文档中的具体约束发问
- ❌ 接受模糊回答就跳过 → ✅ 追问到可执行的程度
- ❌ 只挑毛病不给建议 → ✅ 每个问题附带推荐方案
- ❌ 忽略文档缺失的情况 → ✅ 文档缺失本身就是一个拷问点

## Completion Checklist

- [ ] 所有 Required Design Documents 已读取
- [ ] 已从文档中提取关键架构约束
- [ ] 覆盖了全部 6 个拷问维度
- [ ] 每个问题都引用了具体的设计文档内容
- [ ] 每个问题都给出了 AI 推荐答案
- [ ] 用户的所有回答已记录
- [ ] 输出了完整的总结报告
- [ ] 已与用户确认 feature 名称（kebab-case），总结报告已按模板保存到 `Todo/Grills/{feature-name}-grill.md`
- [ ] 标注了需要更新的设计文档
- [ ] 已按模式自动衔接进入下游（标准 → write-a-spec；simple → tdd 无计划模式）

## Next Step Guidance

拷问结束并保存总结报告后，**按模式自动衔接，无需用户再次触发**。

**标准模式**——向用户提示后直接开始执行 write-a-spec 流程：

```
✅ 拷问完成！所有关键决策已确认，总结报告已保存到 Todo/Grills/{feature-name}-grill.md

📋 正在直接进入 write-a-spec（决策已全部确认，无需再次触发）。
   Spec 完成后请人工 review，确认无误后再显式使用 /spec-to-plan。
```

**simple 模式**——向用户提示后直接开始执行 tdd（无计划模式）：

```
✅ 拷问完成！所有关键决策已确认，总结报告已保存到 Todo/Grills/{feature-name}-grill.md

📋 正在直接进入 tdd（无计划模式，以拷问报告为输入）。
   tdd 的 Planning 步骤会先与你确认待测行为清单，确认后才开始改码；
   全部行为完成后将自动执行 design-doc-sync 收尾。
```
