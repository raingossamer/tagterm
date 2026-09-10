# ProjectModel — 通用 AI 驱动开发范式

这是一套**与编程语言无关的通用工程范式**：用一条闭环流水线，约束 AI（及人类）在统一节奏下完成"设计 → 需求 → 计划 → 实现 → 文档同步"的全流程，架构审视作为按需工具挂在收尾之后。

> **核心理念**：设计文档是唯一真相源。每个 Skill 要么**读它**（约束自己），要么**写它**（保持同步），形成"设计 ↔ 代码"双向闭环。方法论恒定，技术栈可替换。

---

## 开发流水线

```
按改动规模选路径（凡改码，必以 design-doc-sync 收尾）：

① 主流水线（大功能）：
  grill-me-with-design →(自动) write-a-spec → spec-to-plan →〔/compact〕→ tdd →(自动) design-doc-sync
        ↑                                                                             │
        └── 循环：新一轮 grill；或改动大时按需显式 improve-codebase-architecture → "rfc to plan" 走 ② ──┘

② RFC 快车道（实施已审视的架构 RFC）：
  显式 "rfc to plan"（通常紧接 improve 之后；也可对沉淀的 accepted RFC 随时发起）
    → spec-to-plan（以最新 status: accepted 的 RFC 为输入）→〔/compact〕→ tdd →(自动) design-doc-sync
  （前提：Design 已与代码同步 —— 紧接 improve 时天然满足；无需重走 grill / write-spec；
   不经过 improve —— RFC 本身就是它的产物，快车道只实施、不再产出新 RFC）

③ 中型改动（grill me simple）：
  grill-me-with-design（simple 模式，拷问深度同标准）→(自动) tdd（无计划模式，以 Grill 报告为输入）→(自动) design-doc-sync

④ 零散小改动：
  read-design-before-code（读设计 → 改码）→(自动) design-doc-sync

旁路工具：
  to-design                 生成 Design 五份（架构章节 + 规范章节；双模式，仅显式触发）：
                              · 逆向：已有代码 → Design（接手旧项目；规范章节每条须指向本项目代码 / 配置证据，无证据写待确认）
                              · 正向 0-to-1：需求描述 + 技术栈问答 → Design（规范章节按选定技术栈的社区基线草拟、汇总确认一次）
  improve-codebase-architecture  架构审视（仅显式触发；只产出 RFC、不改代码；典型时机：sync 出完三份报告、压缩上下文之后，改动大 / 摩擦明显时）
  read-design-before-code   非 TDD 改码前读设计（已内嵌于 tdd；同时是路径④的入口）
```

| 阶段 | Skill | 输入 → 产出 |
|------|-------|------------|
| 1 拷问 | grill-me-with-design | 想法 → 经验证的决策 |
| 2 需求 | write-a-spec | 决策 → `Todo/Specs/{feature}-spec.md` |
| 3 计划 | spec-to-plan | Spec → `Todo/Plans/{feature}-plan.md` |
| 4 实现 | tdd | Plan → 代码（Red-Green-Refactor） |
| 5 同步 | design-doc-sync | 最终代码 → 更新 `Design/` + **三份报告**（文档同步 / Delta & 人工动作清单 / Git 提交描述）（**流水线最后一步，tdd 后自动衔接**） |
| 旁路 架构审视 | improve-codebase-architecture | 代码库 → `Todo/Rfcs/{module}-rfc.md`（不在流水线内，sync 之后按需显式触发；产物经路径 ② 实施） |

> **关键顺序**：文档同步（`design-doc-sync`）永远是每条改码路径的**最后一步**，且在 tdd（或零散改码）完成后**自动衔接** —— 代码定型后立刻统一更新设计文档。架构审视（`improve-codebase-architecture`）**只产出 RFC、不改代码**，所以不排在 sync 之前；sync 出完三份报告后由你按需显式触发（改动大 / 摩擦明显时），其 RFC 通过快车道实施。

---

## RFC 生命周期

`Todo/Rfcs/` 中每份 RFC 以 frontmatter `status` 字段跟踪状态，避免过时提案与"设计文档是唯一真相源"冲突：

| 状态 | 含义 | 由谁设置 |
|------|------|---------|
| `proposed` | 方案已沉淀，但用户尚未选定接口 | improve-codebase-architecture |
| `accepted` | 用户已选定接口，等待实施（RFC 快车道的入场券） | improve-codebase-architecture |
| `implemented` | 已实施且设计文档已同步 | design-doc-sync（收尾时更新） |
| `superseded` | 被后续 RFC 取代（取代者正文注明取代了哪份） | 产生取代 RFC 时 |

**注意**：RFC 是提案而非已实现的代码。`improve-codebase-architecture` 只产出 RFC，不动代码；实施 RFC 必须走 RFC 快车道（显式 "rfc to plan" → spec-to-plan 拆迁移切片 → tdd → 自动 sync 收尾并置为 `implemented`）。前提是 Design 已与代码同步 —— 紧接 improve 进入时天然满足（sync 在 tdd 后已自动执行，improve 不改代码）；对沉淀多轮后的 RFC，先确认最近一次改码已 sync，否则实施轮的 `tdd` Pre-read Design 读到的是过期文档。

**RFC 可以沉淀，不必立即实施**：每轮 `improve-codebase-architecture` 都基于**当时的代码**重新探索 —— 旧 RFC 指出的摩擦若仍然存在，会被新一轮 RFC 重新包含。由此推出三条规则：

- 快车道始终**以最新的 `accepted` RFC 为输入**，不实施过时提案；
- `improve` 保存新 RFC 时，检查 `Todo/Rfcs/` 中未实施（`proposed` / `accepted`）的旧 RFC，与新 RFC 范围重叠的置为 `superseded` 并注明被谁取代；
- 快车道**不经过** `improve-codebase-architecture`（RFC 本身就是它的产物，重进会递归产出 RFC），tdd 完成后直接以 `design-doc-sync` 收尾。

### 其他产物的轻量状态

- `Todo/Specs/` 与 `Todo/Plans/`：frontmatter `status: active | done` 两态 —— 创建时置 `active`，对应功能收尾的 `design-doc-sync` 置 `done`，避免已完成与进行中的产物混杂。
- `Todo/Grills/`：不设状态 —— 同一 feature 重新拷问即覆盖同名报告（最新为准）；simple 模式的行为清单进度记录在报告内部。

---

## 目录结构

```
ProjectModel/
├── README.md                # 本文件：框架总入口
├── pipeline.html            # 四条路径与文档读写关系的可视化（本地打开即可，流程变更时同步更新）
├── slides.html              # 开发规范演示稿（本地打开，← → 翻页，Ctrl+P 可导出 PDF；流程变更时同步更新）
├── Design/                  # 设计文档（唯一真相源，共 5 份；每份含架构章节 + 规范章节）
│   ├── frontend.md          #   前端设计
│   ├── backend.md           #   后端设计
│   └── database/
│       ├── database-relations.md  # 表关系文字说明 + 基数
│       ├── data-er.md             # ER 图（Mermaid erDiagram + 简述）
│       └── sql.md                 # 建表原生 SQL
├── Skills/                  # 8 个流程 Skill，每个含 SKILL.md（tdd 另含 README + 配套文档）
└── Todo/                    # Skill 产物
    ├── Grills/              #   grill-me-with-design 总结报告（write-a-spec / tdd 无计划模式的正式输入）
    ├── Specs/               #   write-a-spec 产出（frontmatter status: active/done）
    ├── Plans/               #   spec-to-plan 产出（frontmatter status: active/done）
    └── Rfcs/                #   improve-codebase-architecture 产出（frontmatter status 跟踪生命周期）
```

> **产物命名**：全链以 `grill-me-with-design` 阶段与你确认的 kebab-case `{feature-name}` 为文件名前缀串联（`-grill.md` → `-spec.md` → `-plan.md`）；架构 RFC 用 `{module-name}-rfc.md`。

### 两类章节（正交，缺一不可）

每份 Design 文档由两类章节组成，不设独立的规范文件：

| 章节 | 约束什么 | 谁写 | 谁读 |
|------|---------|------|------|
| **架构章节**（技术栈 / 目录 / 模块边界 / API / 数据模型 / 流程 / 认证） | **做什么、边界在哪** | `to-design`（建基线）、`design-doc-sync`（同步） | 全部改码环节 + `grill` + `write-a-spec` |
| **规范章节**（`frontend.md` / `backend.md`「设计模式与约定」、`database/sql.md`「约定」） | **代码怎么写** —— 格式化、分层、异常与响应、日志、命名、跨层命名对照 | `to-design`（首次建立：逆向取证 / 正向社区基线）+ `tdd` / `read-design-before-code`（改码中的规范候选，**经你显式判定**后写入）**+ 你手工维护** | 同上 —— 读 Design 即读到规范，`grill` 据此拷问命名与写法一致性 |

- **规范章节基于基准事实**：骨架本身中立，每行都是 `示例：` 占位，不预设任何技术栈或写法。逆向模式下每条规范必须指向配置文件或跨模块抽样的源码（占比 ≥ 80% 才成规范，否则列为待裁决冲突），**禁止用社区惯例填补无证据处**；正向模式由模型按选定技术栈给出社区基线草案、汇总确认一次。每条已填规范末尾以 `〔来源：…〕` 标注依据，没有来源的条目视为待核实。
- **规范章节的手工维护受保护**：`to-design` 遇到已填的规范章节一律逐条展示差异、询问覆盖/合并/取消，**默认推荐合并**，绝不静默覆盖你手写的团队约定；代码写法与你的规范冲突时列出冲突交你裁决（可能是代码该改，而非规范该改）。
- **规范变更必须由你显式判定**：`design-doc-sync` 只同步架构章节，**不改动规范章节**。`tdd` 把待确认项的裁决与首次引入的项目级写法约定记为**规范候选** —— 单切片模式每片完成时问你，auto / 无计划模式累积到全部切片完成时一次性问；`read-design-before-code` 在改码完成时问。同意才写并附来源，不同意则只作为本次的局部决定。规范是项目级稳定约定，要改规范本身就是一次独立决策，不随单个功能自动变动；模块内的写法归架构章节（模块边界、核心业务流程等），由 sync 正常同步。

---

## 占位词约定

设计文档（`Design/` 五份，含各文档的规范章节）采用**骨架模板 + 占位词**的方式：章节标题固定，内容逐步填充。以下占位词**全部表示"该处尚未填入真实内容 / 尚未决策"**，任一出现即视为该章节"未填/未决"：

| 占位词 | 含义 | 典型位置 |
|--------|------|---------|
| `示例：…` | 参考样例，提示该处该填什么格式；**未被真实内容替换前 = 未决** | 表格行、字段值 |
| `暂无` | 该章节本项目不适用 | 不适用的章节 |
| `待补充` / `待确认` | 明确"必须填但还没填" | 待办点、`## 待确认问题` |
| `<TODO>` | 同上，更显式的强标记（可选用） | 任意位置 |

> **判定限定**：`示例：` 仅在**行首或独立成项**（表格单元、列表项开头）时视为占位词；正文行内举例一律写"如："，避免把合法内容误判为未决。

**工具行为统一**：一个章节里只要仍含上述任一占位词，即判定该章节"未填/未决"；只有当占位词被替换为真实内容（移除这些标记）后，才算"已填"。

- `grill-me-with-design` 据此识别未决点并优先追问，而非把占位样例当作既定约束。
- `to-design`（正向模式）据此判定"仅含骨架"的文件，填充时不必逐文件确认。

---

## 如何使用

### 新功能（标准流程）

从拷问开始，沿流水线推进。人工卡点在**产物 review** 上，而非流程触发上：

```
grill me →（自动衔接）write spec →〔人工 review Spec〕→ spec to plan →〔人工 review 切片〕→〔/compact 或 /clear〕
  → tdd（单切片）/ tdd auto（连续执行）→（自动衔接）sync design docs（附三份报告：文档同步 / Delta & 人工动作清单 / Git 提交描述）
  →〔你选择〕新一轮 grill me；或改动大时〔/compact〕→ improve architecture → rfc to plan 走快车道
```

- grill 完成并保存报告后**自动进入** write-a-spec，无需再次触发（拷问决策已逐个确认）
- Spec → plan、plan → tdd 两处为**人工卡点**：review 产物、确认后显式触发。两处都在终端给出可直接判定的摘要，不必通读产物 —— write-a-spec 保存后输出 **Review 摘要**（问题 / 方案 / 影响面 / 关键决策 / 相对 Grill 的新增决策 / 兼容性 / 开放问题）并给出建议 review 深度；spec-to-plan 在保存前以编号列表展示切片并迭代到你批准
- plan → tdd 之间**先压缩上下文**（`/compact` 或 `/clear`，spec-to-plan 收尾时会提示）：tdd 的输入已全部落盘，这是全流程最安全的压缩点；主动压缩可避免自动压缩落在切片的 RED 与 GREEN 之间。压缩或新会话后 tdd 一律重读 Plan / Spec / Design，不依赖对话记忆
- tdd 双模式：`tdd` 每片暂停确认；`tdd auto` 连续执行 AFK 切片，仅在 HITL 切片或阻塞时暂停
- tdd 全部切片完成后**自动衔接** design-doc-sync，无需触发
- sync 出完三份报告后**由你选择**：改动大 / 摩擦明显 → 建议先压缩上下文，再显式 improve architecture（只产出 RFC、不改代码，随后可用 rfc to plan 实施）；否则直接开新一轮 grill me
- 收尾 sync 除同步文档外，必须输出 **Delta & 人工动作清单**（DDL、配置中心、数据迁移等待办，每项标注 ✅ 代码已完成 / ⏸️ 需人工执行）与 **Git 提交描述**（Conventional Commits：feat / fix / refactor…，只给文本不代执行提交）

### 中型改动（grill me simple）

跨 1-2 个模块、涉及 API 契约 / 表字段等风险、但无需 Spec 级需求梳理时：

```
grill me simple（拷问深度与标准模式完全一致，报告仍落盘 Todo/Grills/）
  →（自动）tdd 无计划模式（以 Grill 报告为输入；Planning 步骤与你确认行为清单后才改码）
  →（自动）design-doc-sync（收尾：三份报告 —— 文档同步 / Delta & 人工动作清单 / Git 提交描述）
```

**"simple" 指流水线更短（跳过 Spec 与切片计划），不是拷问更浅** —— Grill 报告是这条路径的唯一需求载体，没有 Spec 兜底，拷问必须同样扎实。全程只需触发一次（grill me simple），中途人工参与是拷问答题和确认行为清单。

### 实施架构 RFC（快车道）

`improve-codebase-architecture` 产出的 RFC 已经过多方案对比与用户选定（`status: accepted`），无需重走拷问与 Spec。通常紧接 improve 之后进入，也可以对沉淀的 accepted RFC 在任何时候显式发起：

```
rfc to plan（显式触发；前提：Design 已与代码同步 —— 紧接 improve 时天然满足，沉淀多轮后先确认最近改码已 sync）
  → spec-to-plan（以最新的 accepted RFC 为输入，拆解绞杀式迁移切片）→〔/compact〕
  → tdd →（自动）design-doc-sync（收尾，并将 RFC 置为 implemented）
```

快车道跳过 grill / write-spec，也**跳过 improve-codebase-architecture** —— 它只实施 RFC，不再产出新 RFC。若多份 RFC 覆盖同一模块，以最新的 `accepted` 为准（更早的应已被置为 `superseded`）。

### 从 0 到 1（全新项目，文档驱动）

没有代码、只有想法时，先显式运行 **`to design`**：它扫描到无源码会自动进入**正向模式**，通过需求访谈 + 技术栈问答，把决策填入 `Design/` 五份文档，再进入主流水线：

```
to design（描述需求 → 问答定前后端技术栈 → 生成 Design 五份）
  → grill me（拷问刚生成的设计）
  → write spec → spec to plan → tdd →（自动）design-doc-sync
```

### 既有代码项目（先建立设计基线）

若项目已有代码但无设计文档，先显式运行 **`to design`**：它扫描到源码会自动进入**逆向模式**，分析代码生成 `Design/` 五份基线文档，再进入主流水线。

> 两种模式由 `to design` 启动时扫描目录自动判定，模糊时会向你确认一次。

### 零散改码（非完整流程）

小 Bug / 独立重构无需走完整流水线，直接用 **`read-design-before-code`**（改码前读设计）即可；改码完成后**自动衔接** `design-doc-sync`（同步受影响文档 + 三份报告：文档同步 / Delta & 人工动作清单 / Git 提交描述；小改动的 Delta 多数类为"无"）。

---

## 设计哲学（跨语言不变量）

无论用什么技术栈，以下原则恒定：

- **设计文档是唯一真相源** —— 读它约束自己，写它保持同步
- **垂直切片** —— 每个切片端到端（schema → API → UI → tests），禁止水平切片
- **只测可观察行为** —— 测试通过公共接口断言，能扛住内部重构
- **深模块** —— 小接口 + 深实现，在边界测试而非内部
- **文档最后同步** —— 代码定型后再统一更新设计文档

---

## 技术栈与可移植性

本范式与编程语言无关。唯一含语言相关代码示例的地方是 `Skills/tdd/` 下的配套文档；切换技术栈时只需改那几份，流程定义本身一字不动。详见 `Skills/tdd/README.md`。规范章节的语言基线不落盘：正向模式由模型按选定技术栈现场草拟、你确认一次。

当前示例覆盖：**Java**（JUnit5/Mockito）、**Python**（pytest）、**TS/Vue**（Vitest + Vue Test Utils）。

---

## 触发规则

8 个 Skill 有三种触发方式，叠加生效：

1. **显式斜杠命令**（最稳定）：键入 `/skill-name`，由 `user-invocable: true` 决定 —— 8 个 Skill 全部支持。
2. **模型自动调用**（语义匹配）：用自然语言描述意图，由模型读 `description` 关键词判断；由 `disable-model-invocation: false` 决定 —— 7 个支持，仅 `to-design` 禁用。
3. **流水线下游引导**：每个 Skill 完成后在 `Next Step Guidance` 中**提示**进入下一阶段。以下衔接**自动执行**：grill → write-a-spec（主流水线）；grill → tdd（simple 中型路径）；tdd → design-doc-sync（全部路径）；read-design-before-code → design-doc-sync（零散改动）。其余衔接（Spec → plan、plan → tdd、sync → improve、improve → rfc to plan）均需你显式触发。原则：**方向决策必须显式，机械收尾一律自动**。

### 触发对照表

| Skill | 显式命令 | 英文触发关键词（自然语言） | 模型自调用 |
|-------|---------|--------------------------|:---:|
| grill-me-with-design | `/grill-me-with-design` | "grill me" / "grill me simple"（中型改动路径） / "stress-test design" / "validate my design" | ✅ |
| write-a-spec | `/write-a-spec` | "write spec" / "create spec" / "draft spec" | ✅ |
| spec-to-plan | `/spec-to-plan` | "spec to plan" / "rfc to plan"（RFC 快车道） / "convert spec to plan" / "break down spec" | ✅ |
| tdd | `/tdd` | "tdd" / "tdd auto"（连续执行切片模式） / "red green refactor" / "test-driven development" | ✅ |
| improve-codebase-architecture | `/improve-codebase-architecture` | "improve architecture" / "review architecture" / "deepen modules" | ✅ |
| design-doc-sync | `/design-doc-sync` | "sync design docs" / "update design docs" | ✅ |
| read-design-before-code | `/read-design-before-code` | "edit code" / "modify code"（非 TDD 流程） | ✅ |
| to-design | `/to-design` | **仅 "to design" 显式触发** | ❌ |

**三个特殊点**：

- `to-design` 是唯一禁止模型自调用的 Skill（`disable-model-invocation: true`），必须显式输入 "to design" 或 `/to-design` 才触发 —— 因为它会覆盖 / 合并 `Design/`，影响大，需主动发起。
- `read-design-before-code` 已内嵌于 `tdd` 每片的 READ 步骤（GREEN 之前）自动执行；仅在**非 TDD 流程**的零散改码时才需手动触发。
- `improve-codebase-architecture` 不在任何流水线内：只产出 RFC、不改代码，由 `design-doc-sync` 收尾提示后按需显式触发；其 RFC 经你显式输入 "rfc to plan" 走快车道实施。

> 触发关键词的权威来源是根目录三份镜像文件（内容必须保持一致）：
> - `CLAUDE.md`（Claude Code）
> - `AGENTS.md`（通用 Agents）
> - `.github/copilot-instructions.md`（GitHub Copilot）
