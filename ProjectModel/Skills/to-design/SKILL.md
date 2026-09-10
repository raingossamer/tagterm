---
name: to-design
description: "Generate the five design docs into ProjectModel/Design/ — architecture sections plus each doc's project-level coding-convention section (frontend.md / backend.md「设计模式与约定」, sql.md「约定」) — in two modes auto-selected by scanning the target directory: REVERSE mode reverse-engineers an existing codebase (every convention must cite evidence from the project's own code or config; no evidence means 待确认); FORWARD mode (0-to-1) generates design docs from a requirements description plus a tech-stack interview, drafting conventions from the chosen stack's community baseline for one-shot confirmation. Triggered only when the user explicitly types 'to design'."
argument-hint: "Optional: project root path to analyze (defaults to the current workspace root). For 0-to-1, just describe your requirements."
user-invocable: true
disable-model-invocation: true
---

# To Design — 生成设计文档（逆向 / 正向双模式）

本 Skill 产出 `ProjectModel/Design/` 五份设计文档。每份文档含两类正交章节：**架构章节**（做什么、边界在哪）与**规范章节**（代码怎么写：`frontend.md` / `backend.md` 的「设计模式与约定」、`sql.md` 的「约定」）。支持两种模式：

- **模式 A（逆向 Reverse）**：分析**已有代码** → 架构章节 + 从代码证据提取规范章节（接手无文档的旧项目）
- **模式 B（正向 Forward / 0-to-1）**：根据**需求描述 + 技术栈问答** → 架构章节 + 按语言社区基线草拟规范章节（从 0 到 1 的文档驱动开发）

模式由 **Phase 0** 扫描目标目录后自动判定，并向用户确认。

## Pipeline Position

```
[任意阶段] → /to-design → [/grill-me-with-design]
```

此 Skill 为独立工具，可在任意阶段显式调用。生成的文档将作为其他 Skill 的设计参考。

## 触发条件

仅当用户显式输入 **"to design"** 时触发，不会被其他 Skill 自动调用。
触发后由 Phase 0 自动判定走逆向还是正向分支。

## 输入

| 参数 | 说明 | 默认值 |
|------|------|--------|
| 项目根目录 | 要分析的代码根路径（逆向模式） | 当前工作区根目录 |
| 需求描述 | 项目要解决的问题与核心功能（正向模式） | 由问答收集 |

---

## Phase 0: 模式判定（双模式入口）

1. 扫描目标目录，检测是否存在源码（如 `.java` / `.py` / `.ts` / `.vue` 等业务源文件）。
2. 根据扫描结果给出**建议模式**：
   - 发现源码 → 建议 **模式 A（逆向）**
   - 无源码 / 仅有空的 Design 骨架 → 建议 **模式 B（正向 / 0-to-1）**
3. **向用户确认**建议模式（模糊时尤其重要）：
   ```
   目录中{未发现/发现}源码，判断为【模式 X】。确认按此模式继续？
   ```
4. 用户确认后，进入对应分支。

---

## 模式 A：逆向（代码 → Design）

### A1. 项目扫描

1. 扫描项目根目录结构，识别技术栈和模块划分
2. 检测以下信息：
   - 前端框架（React / Vue / Angular / 原生等）
   - 后端框架（Express / Nest / Spring / Django / FastAPI 等）
   - 数据库类型（MySQL / PostgreSQL / MongoDB 等）
   - 目录结构模式（MVC / 分层 / Monorepo 等）
3. 向用户确认识别结果，如有偏差需修正

### A2. 前端分析 → `ProjectModel/Design/frontend.md`（架构章节）

读取前端源码，分析：技术栈、目录结构、核心页面/路由、状态管理、API 调用层，填充 `frontend.md` 的架构章节。规范章节在 A5 处理。

### A3. 后端分析 → `ProjectModel/Design/backend.md`（架构章节）

读取后端源码，分析：技术栈、目录结构与分层、模块边界、API 端点、核心业务逻辑、认证授权，填充 `backend.md` 的架构章节。规范章节在 A5 处理。

### A4. 数据库分析 → `ProjectModel/Design/database/`

读取数据库相关代码（Migration / Schema / Model / Entity），分析表结构、关系、索引、枚举值，生成：

1. `database/sql.md` — 原生建表 SQL（「约定」章节在 A5 处理）
2. `database/database-relations.md` — 表关系文字说明与基数（一对一 / 一对多 / 多对多）
3. `database/data-er.md` — 用 Mermaid `erDiagram` 语法绘制 ER 图，并附简要描述

### A5. 代码规范提取 → 各文档的规范章节（只写代码证据，禁止先验填充）

从**代码实际写法**提取项目级规范，写入 `frontend.md` / `backend.md` 的「设计模式与约定」与 `sql.md` 的「约定」。

> **基准事实原则**：规范章节的每一条都会被 `tdd` 与 `read-design-before-code` 当作既定约束执行。**每一条规范都必须能指向本项目中的一处证据**；不得沿用骨架中的 `示例：` 内容，不得用社区惯例、框架默认或"通常做法"填充。

1. **硬证据优先**：读取格式化与静态检查配置 —— `.editorconfig` / `.prettierrc` / ESLint / Checkstyle / Spotless / ruff / black / `.gitattributes` 等。其中的缩进、引号、行宽、命名规则是**已确定的事实**，直接落入规范章节，来源写配置文件路径。
2. **抽样观察代码惯例**：对每类目标（Controller / Service / Repository / Entity / 页面组件 / 公共组件 / API 层 / 路由 / 迁移脚本）**至少抽样 5 个文件**（不足 5 个则全部读取），抽样须**跨模块、跨时期**，避免同一作者近期文件造成假共识。逐项统计写法：分层职责、异常处理、响应结构、日志、注释与事务、组件风格与目录组织、命名（类 / 方法 / 变量 / 常量 / 文件 / 路由 / 表字段）、跨层字段命名转换位置。
3. **写入门槛**：某写法在抽样中占比 **≥ 80%** 才可写为规范，来源写 `抽样 n/m` 与一个代表性文件路径，少数例外记入该文档「待确认问题」；占比不足即视为**冲突**。
4. **冲突不静默**：同一约定存在多种写法时，**列出各写法、出现位置与占比，标注为待裁决**，写入该文档「待确认问题」交用户拍板 —— **不要私自挑一种当作规范**；未裁决前该条保留 `待确认` 占位词。
5. **无证据即待确认**：代码与配置中找不到依据的项，保留 `示例：` 或写 `待确认` —— 一条臆造的规范会污染之后所有代码。
6. 本项目不适用的小节保留标题并标注"暂无"。

### A6. 交叉验证

1. 检查前端 API 调用与后端端点是否一致
2. 检查后端 Model 与数据库表是否对应
3. 检查前后端数据字段是否匹配，并与 `backend.md`「跨层命名对照」一致
4. 将发现的差异记录在各文档的 `## 待确认问题` 部分

→ 进入 **Phase 9: 输出与确认**

---

## 模式 B：正向 / 0-to-1（需求 → Design）

> 适用于尚无代码、希望先产出设计文档再开发的文档驱动场景。

### B1. 需求访谈

1. 请用户详细描述：要解决的问题、目标用户、核心功能清单、关键业务流程。
2. 逐项追问，直到对问题域和功能边界有清晰共识（不确定处主动提问，不臆测）。
3. 输出一份功能清单与核心实体的初步草稿，供用户确认。

### B2. 技术栈问答

通过问答确定技术选型（即"选择前后端技术栈"的环节）。逐项确认并给出推荐默认值：

| 维度 | 选项示例 | 推荐默认 |
|------|---------|---------|
| 后端语言/框架 | Java + Spring Boot / Python + FastAPI | 按用户偏好 |
| 持久层 | MyBatis / JPA / SQLAlchemy | — |
| 数据库 | MySQL / PostgreSQL | MySQL |
| 前端框架 | Vue 3 + TS / React | Vue 3 + TS |
| 状态管理 / UI 库 | Pinia / Element Plus 等 | — |
| 认证方案 | JWT / Session | JWT |

每项给出推荐，等用户确认或修改。

### B3. 模块与数据建模

1. 根据需求草拟后端模块边界、核心 API 端点、前端页面/路由。
2. 草拟数据库表、字段、关系与基数（这是后续 Design 文档的核心）。
3. 主动寻找可独立测试的深模块。
4. 向用户确认建模结果。

### B4. 填充架构章节

按问答与建模结果，将内容**填入 `ProjectModel/Design/` 五份骨架文档的架构章节**（保持骨架的固定章节结构）：

- `frontend.md` — 技术栈、目录结构、路由、页面组件、状态管理、API 调用层
- `backend.md` — 技术栈、分层、模块边界、API 端点、核心业务流程、认证授权
- `database/database-relations.md` — 表清单、关系基数、约束、枚举值
- `database/data-er.md` — Mermaid `erDiagram` ER 图 + 实体描述
- `database/sql.md` — 建表 DDL（按确定的数据库方言）

### B5. 规范章节生成（语言社区基线，一次性确认）

新项目尚无代码惯例可循，与 B2 推荐技术栈同一方式 —— 由模型按选定技术栈给出社区主流约定草案，用户确认一次：

1. 按 B2 选定的语言 / 框架草拟 `frontend.md` / `backend.md`「设计模式与约定」与 `sql.md`「约定」的全部小节：格式化工具与缩进、组件与分层风格、异常与响应结构、日志、注释与事务、命名约定、跨层命名对照。数据库命名须与 B3 的数据建模一致，不一致处以 B3 为准并提示用户。
2. **整份汇总展示、确认一次**，不逐项询问：用户只改想改的项。被修改的项来源写 `〔来源：用户指定〕`，其余写 `〔来源：{语言 / 框架} 社区基线，用户确认 YYYY-MM-DD〕`。
3. 用户明确表示"待定"的项保留 `待确认` 占位词，不要臆造。

### B6. 自检

1. 前端 API 调用层与后端端点是否对应。
2. 后端实体与数据库表是否一致，字段命名符合「跨层命名对照」。
3. ER 图、关系说明、建表 SQL 三者是否相互吻合。
4. 仍未定的点记入各文档的 `## 待确认问题`。

→ 进入 **Phase 9: 输出与确认**

---

## Phase 9: 输出与确认（两模式共用）

1. 写入前，先判定每个目标文件的**每个章节**属于哪一类（占位词约定见 `ProjectModel/README.md`「占位词约定」）：
   - **空骨架章节**：仅含骨架模板 / 占位词（`示例：` / `暂无` / `待补充` / `待确认` / `<TODO>`），无真实业务内容。
   - **已填章节**：含真实业务内容。
2. 按类别处理：
   - **全部章节皆为空骨架的文件**：**一次性汇总确认**，而非逐个询问。例如：
     ```
     以下文件为空骨架，将按【合并填充】写入（含各文档的规范章节）：
       - Design/frontend.md
       - Design/backend.md
       - Design/database/database-relations.md
       - Design/database/data-er.md
       - Design/database/sql.md
     确认？(确认 / 调整)
     ```
     用户确认后一并填充（合并：保留固定章节结构，填入内容、移除占位词）。
   - **含已填章节的文件**：**按章节**处理，这就是"补充设计"—— 仍含占位词的章节视同空骨架直接填充；已含真实内容的章节逐个展示差异并询问 **覆盖 / 合并 / 取消**，只补缺口，不重写已有决策。
3. **规范章节的特殊保护**（`frontend.md` / `backend.md`「设计模式与约定」、`sql.md`「约定」，可能含用户**手写的团队约定**）：只要已填即**逐条**展示差异并询问覆盖 / 合并 / 取消，**默认推荐"合并"**（保留手写内容，仅补充缺失小节与占位词），**任何情况下不得静默覆盖用户手写的规范**。若代码实际写法与用户手写规范冲突，列出冲突点交用户裁决 —— 可能是代码该改，而非规范该改。写入规范章节的**每一条**都须经用户显式确认（空骨架的汇总确认亦算），逆向模式每条附代码 / 配置证据，正向模式每条附社区基线来源。
4. 将所有文档写入 `ProjectModel/Design/` 对应文件。
5. 输出设计文档摘要给用户；逆向模式额外汇报规范章节：已写条数、待裁决冲突条数、无证据保留待确认的条数。

## 输出文件

```
ProjectModel/Design/
├── frontend.md          # 前端设计文档（架构章节 + 「设计模式与约定」规范章节）
├── backend.md           # 后端设计文档（架构章节 + 「设计模式与约定」规范章节，含跨层命名对照）
└── database/
    ├── database-relations.md  # 数据库关系（文字说明 + 基数）
    ├── data-er.md             # ER 图（Mermaid erDiagram + 简要描述）
    └── sql.md                 # 数据库表原生 SQL（含「约定」规范章节）
```

> 架构章节约束"做什么、边界在哪"，规范章节约束"代码怎么写"，两类章节正交。
> 下游 `tdd`（READ 阶段）与 `read-design-before-code` 在改码前**两类都读**，规范才能真正生效。
> 本 Skill 只负责规范章节的**首次建立与显式重跑**；之后改码中产生的规范候选由 `tdd` / `read-design-before-code` 列出并**经用户显式判定**后写入，`design-doc-sync` 不改动规范章节。

## Next Step Guidance

设计文档生成完成后，建议：

- 输入 **"grill me"** 对生成的设计进行审视验证（**正向模式尤其推荐**：拷问刚成形的设计，确保从 0 到 1 的决策无漏洞；规范章节中仍为占位的条目会被当作未决点追问）
- 或直接进入 **"write spec"** 基于已生成的 Design 添加 / 细化需求

```
✅ Design 五份已生成（模式 {A 逆向 / B 正向}）。
   规范章节：已写 {n} 条（均附来源）/ 待裁决冲突 {k} 条 / 无证据保留待确认 {j} 条

📋 下一步：使用 /grill-me-with-design 拷问刚生成的设计，
   通过后走 write-spec → spec-to-plan → tdd →（自动）design-doc-sync 完整流水线。
```
