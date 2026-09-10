---
name: tdd
description: "Test-driven development using the Red-Green-Refactor loop, executed slice-by-slice per the implementation plan. Two modes: 'tdd' pauses after each slice for user confirmation; 'tdd auto' runs slices continuously, pausing only on HITL slices or blockers. Use when the user wants to build features or fix bugs using TDD, mentions 'tdd auto', 'red green refactor', wants integration tests, or asks for test-first development."
argument-hint: "Slice number or Plan filename to implement, optionally with 'auto' mode, e.g. 'Slice 1', 'payment-module', 'auto payment-module'"
user-invocable: true
disable-model-invocation: false
---

# Test-Driven Development

## Pipeline Position

```
grill-me-with-design → write-a-spec → spec-to-plan → 【tdd】 → design-doc-sync
                                                   ↑_____________↓ (按切片迭代)
```

> 四条路径全景（权威图）见 `ProjectModel/README.md`「开发流水线」；上图仅示意本 Skill 的位置。

**上游**：接收 `spec-to-plan` 生成的实施计划（位于 `Todo/Plans/` 目录）；或由 `grill-me-with-design` simple 模式**自动衔接**进入（无计划模式，见下文）
**下游**：全部切片（或无计划模式的全部行为）完成后，**自动衔接** `design-doc-sync`（四条路径统一，无需用户触发）。架构审视 `improve-codebase-architecture` 不在流水线内、不改代码，由 sync 收尾提示后用户按需**显式触发**。

## Execution Modes

| 模式 | 触发 | 行为 |
|------|------|------|
| 单切片（默认） | `tdd` | 每完成一个切片，更新计划状态并**暂停**，由用户决定是否继续下一片 |
| 连续（auto） | `tdd auto` | 按依赖顺序**连续执行** AFK 切片，不逐片询问 |

**auto 模式的暂停条件**（满足任一即暂停并汇报，等待用户决策）：

1. 下一个切片是 **HITL**（计划中标记需要人工决策/评审）
2. 切片被阻塞（Blocked by 的切片未完成或验收未通过）
3. 测试无法转绿，且无法在当前切片范围内合理修复
4. 实现必须偏离设计文档，且偏离会影响其他切片
5. 切片的验收标准含糊到写不出第一个测试（Planning 阶段发现，见 Workflow 第 1 步）—— 不臆测，暂停向用户确认

**auto 模式不省略任何质量步骤**：仍逐片执行 Red-Green-Refactor 与 Pre-read Design，仍逐片更新计划状态与设计读取报告 —— 省略的只是每片之间"是否继续"的人工确认。规范候选在 auto 模式下**只记录不询问**，累积到全部切片完成时一次性交用户判定（见 All Slices Completed），因此它不是暂停条件。

**无计划模式（中型路径，由 grill me simple 自动衔接进入）**：

没有 `Todo/Plans/` 计划文件时，以 `Todo/Grills/{feature-name}-grill.md` 为输入：

1. 拷问报告中已确认的决策 = 本次改动的范围与约束（报告 frontmatter `mode: simple` 即中型路径标识）
2. Planning 步骤中列出待测行为清单，**经用户确认后**，该清单等效于切片列表，并**追加写入 Grill 报告**（在 `Todo/Grills/{feature-name}-grill.md` 末尾新增「## 已确认行为清单」，逐项带状态复选框）—— 会话中断 / 压缩后凭此恢复进度
3. 确认后按行为清单连续执行（等效 auto 模式；暂停条件适用第 3、4 条 —— 测试无法转绿、偏离设计）
4. 每完成一个行为，更新 Grill 报告中该项的状态（等同主流水线逐片更新 Plan）；收尾时在报告中列出已实现行为与设计偏差
5. 全部行为完成后**自动衔接 design-doc-sync**

## Pre-read Plan

在开始 TDD 之前：

1. 从 `Todo/Plans/` 目录读取对应的计划文件 `{feature-name}-plan.md`
2. 确认要实施的切片编号及其验收标准
3. 确认该切片的依赖是否已满足（Blocked by 的切片是否已完成）
4. 若由上下文压缩或新会话进入（spec-to-plan 收尾时会建议在此压缩），以 Plan 中各切片的状态（🟢 Done 等）恢复进度，不依赖对话记忆

**无计划模式例外**：由 grill me simple 衔接进入时没有计划文件，改为读取 `Todo/Grills/{feature-name}-grill.md`（见 Execution Modes 的无计划模式）。

## Pre-read Design（编码前自动读取设计文档，含规范章节）

**每个切片在进入 GREEN 阶段（编写实现代码）之前，必须自动执行以下流程：**

1. 根据当前切片的变更范围（backend / frontend / both），读取对应的设计文档：
   - Backend 涉及 → 读取 `ProjectModel/Design/backend.md`
   - Frontend 涉及 → 读取 `ProjectModel/Design/frontend.md`
   - 数据库涉及 → 读取 `ProjectModel/Design/database/database-relations.md`、`ProjectModel/Design/database/data-er.md` 和 `ProjectModel/Design/database/sql.md`
2. **重点读取所读文档的规范章节**：`frontend.md` / `backend.md` 的「设计模式与约定」、`sql.md` 的「约定」—— 项目级代码规范所在（格式化 / 分层 / 异常与响应 / 日志 / 命名 / 跨层命名对照）
3. 提取约束并分两类应用：
   - 来自 Design：模块边界、API 路径、数据流
   - 来自规范章节：分层职责、异常与响应结构、日志、注释与事务、命名约定
4. 在编写实现代码时严格遵守这两类约束
5. 如果实现不得不偏离设计文档或规范，在切片完成报告中显式说明偏差及原因

**注意**：
- 同一会话中已读取过的文档无需重复读取，除非内容可能已被其他切片修改。**上下文压缩或新会话之后一律视为未读取，必须重读** —— 压缩摘要中对文档的印象不算已读，磁盘上的 Plan / Spec / Design 才是权威输入。
- 规范章节中仍含占位词（`示例：` / `待确认` 等）的条目视为**未决**，不得当作既定规范；若本切片正好触及该未决点，向用户确认一次再落笔。该裁决**不自动写入**设计文档：作为规范候选交用户显式判定 —— 单切片模式在本片完成时问，auto / 无计划模式累积到全部切片完成时一次性问（见 Per-Slice Completion 第 3 项与 All Slices Completed）。

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification - "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" - treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

Before writing any code, list the behaviors this slice must exhibit and the interfaces it touches. **是否需要向用户确认，按进入方式分三种情况** —— 这也是 auto 模式能"不逐片询问"的依据：

| 进入方式 | 行为清单的来源 | 是否向用户确认 |
|---------|--------------|--------------|
| 有 Plan 的 **AFK** 切片（主流水线 / RFC 快车道） | 切片的 Acceptance criteria 与 User stories —— spec-to-plan 的 Quiz 阶段已由用户批准 | **不确认**，直接进入 RED |
| 有 Plan 的 **HITL** 切片 | 同上，但计划标记需人工决策 / 评审 | **确认**：列出切片涉及的接口变更与待测行为，用户批准后再 RED |
| **无计划模式**（grill me simple） | 从 Grill 报告的已确认决策推导 | **确认一次**：列出待测行为清单，用户确认后追加写入 Grill 报告，再连续执行（见 Execution Modes） |

不论哪种情况都要做：

- [ ] Identify opportunities for [deep modules](deep-modules.md) (small interface, deep implementation)
- [ ] Design interfaces for [testability](interface-design.md)
- [ ] List the behaviors to test (not implementation steps)，逐条对应验收标准

若切片的验收标准含糊到写不出第一个测试，**视同 HITL 切片**：停下向用户确认，不要臆测（对应 auto 模式暂停条件 5）。

**You can't test everything.** 行为清单以验收标准为边界，聚焦关键路径与复杂逻辑，不追每一个边缘情况。

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
READ:  读取设计文档（按切片范围，含其规范章节），提取架构约束与代码规范
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet - proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
READ:  如果切片范围变化，读取新涉及的设计文档（含规范章节）
GREEN: Minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior
- GREEN 前必须确认设计文档（含规范章节）的约束已读取（见 Pre-read Design）

### 4. Refactor

After all tests pass, look for [refactor candidates](refactoring.md):

- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Apply SOLID principles where natural
- [ ] Consider what new code reveals about existing code
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
[ ] 编写实现代码前已读取相关设计文档（含规范章节）
[ ] 实现代码符合设计文档架构章节中的约束
[ ] 实现代码符合规范章节的代码规范（命名、分层、异常/响应、日志）
[ ] 如有偏离设计，已显式记录原因
[ ] 规范候选（如有）已记录；单切片模式已交用户显式判定，auto / 无计划模式累积待全部完成时判定
```

## Per-Slice Completion

每完成一个切片后：

1. 更新 `Todo/Plans/{feature-name}-plan.md` 中对应切片的状态为 🟢 Done
2. 如果实现与设计文档有偏差，在 plan 文件中记录偏差说明
3. **规范候选判定（写入规范章节的唯一入口）**：若本切片裁决了规范章节的待确认项，或首次引入了规范章节未覆盖的**项目级**写法约定（如首个定时任务的命名方式、首个枚举的存储方式），记录为规范候选。
   - **单切片模式**：本片完成时列出候选，**询问用户是否写入**对应 Design 文档的规范章节（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」）
   - **auto 模式 / 无计划模式**：只记录不询问，累积到 All Slices Completed 一次性判定 —— 这不是暂停条件，AFK 不被打断；同一会话内后续切片沿用已裁决的写法
   - 用户同意 → 写入对应小节（替换占位词或新增条目），条目末尾附 `〔来源：Todo/Plans/{feature-name}-plan.md Slice N〕`（无计划模式写 Grill 报告路径）；用户不同意 → 不写，仅在报告中记为局部决定
   - 准入门槛：只有"跨模块、未来所有同类代码都应遵守"的约定才是候选；模块内的写法属于该文档的架构章节（模块边界、核心业务流程等），由 `design-doc-sync` 收尾时同步
   - **只有用户显式判定才可写入规范章节**；`design-doc-sync` 只同步架构章节，不改动规范章节
4. **单切片模式**：提示用户是否继续下一个切片；**auto 模式**：输出简短的切片完成摘要后，直接继续下一个无阻塞的 AFK 切片（暂停条件见 Execution Modes）

### Per-Slice Design Read Report

每个切片完成后，附带一份简短的设计读取报告：

1. 读取了哪些设计文档（及其规范章节）
2. 应用了哪些约束（架构约束 + 代码规范）
3. 如有偏离，说明原因
4. 规范候选（如有）：单切片模式附用户裁决结果（已写入规范章节哪几条 / 哪几条作为局部决定）；auto / 无计划模式列出累积待判定的候选

## All Slices Completed

当计划中所有切片（或无计划模式的全部行为）都已完成时，**先做规范候选判定**：auto / 无计划模式累积的候选在此一次性列出，逐条询问用户是否写入对应 Design 文档的规范章节（单切片模式此时应已无待判定候选）。判定完成后，**自动衔接 `design-doc-sync`**（四条路径统一，无需用户触发；代码已定型，架构审视不改代码，不必等它）。sync 按路径做不同的收尾：

| 路径 | 判定依据 | sync 的收尾动作 |
|------|---------|---------------|
| 主流水线 | 计划 Parent 是 `Todo/Specs/` 下的 Spec | Plan 与 Spec 置 `done` |
| RFC 快车道 | 计划 Parent 是 `Todo/Rfcs/` 下的 RFC | RFC 置 `implemented`，Plan 置 `done` |
| 中型路径（simple） | 无计划文件，输入为 Grill 报告 | 无产物状态需更新 |

> 架构审视 `improve-codebase-architecture` 不在此处分岔：它只产出 RFC、不改代码，由 sync 出完三份报告后引导用户按需显式触发（改动大 / 摩擦明显时），其 RFC 再经用户显式输入 "rfc to plan" 走快车道实施。快车道本身不经过它 —— RFC 就是它的产物，重进会递归产出 RFC。

向用户提示（所有路径统一）：

```
✅ 全部实施完成！正在自动进入 design-doc-sync 收尾
   （同步设计文档 + 输出三份报告：文档同步 / Delta & 人工动作清单 / Git 提交描述{；该 RFC 将置为 implemented}）
```